import { useEffect, useRef, useState } from 'react';
import type { State } from '../domain/model';
import { publishReviewCopy, readReviewConnection, reviewRepository, storeReviewConnection, validReviewToken, verifyReviewRepository } from '../domain/reviewSync';
import { Badge } from './ui';

export function usePrivateReview(state:State, available:boolean) {
  const [connection,setConnection]=useState(readReviewConnection);
  const [status,setStatus]=useState({mode:'waiting',message:''});
  const [retry,retryNow]=useState(0);
  const latest=useRef(0), queue=useRef(Promise.resolve());
  const inFlight=useRef<AbortController|null>(null);
  const lastSynced=useRef<{state:State;connection:typeof connection}|null>(null);
  useEffect(()=>{
    const onOnline=()=>retryNow(x=>x+1);
    window.addEventListener('online',onOnline);
    return ()=>window.removeEventListener('online',onOnline);
  },[]);
  useEffect(()=>{
    if(!connection||!available||lastSynced.current?.state===state&&lastSynced.current.connection===connection)return;
    const id=++latest.current;
    setStatus(s=>({mode:'waiting',message:s.message}));
    const timer=window.setTimeout(()=>{
      queue.current=queue.current.then(async()=>{
        if(id!==latest.current)return;
        const abort=new AbortController();
        inFlight.current=abort;
        const timeout=window.setTimeout(()=>abort.abort(),25000);
        setStatus(s=>({mode:'uploading',message:s.message}));
        try {
          const updated=await publishReviewCopy(connection,state,abort.signal);
          lastSynced.current={state,connection};
          if(id===latest.current)setStatus({mode:'success',message:new Date(updated).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})});
        } catch(error) {
          if(id===latest.current)setStatus({mode:'error',message:abort.signal.aborted?'上传超时，稍后可重试。':error instanceof TypeError?'网络未连接，联网后会自动重试。':(error as Error).message});
        } finally {
          clearTimeout(timeout);
          if(inFlight.current===abort)inFlight.current=null;
        }
      });
    },900);
    return ()=>{clearTimeout(timer);latest.current++;};
  },[connection,state,available,retry]);
  useEffect(()=>()=>inFlight.current?.abort(),[]);
  const connect=async(token:string)=>{
    if(!available)throw new Error('请先恢复本机账本再开启核对。');
    if(!validReviewToken(token))throw new Error('请粘贴 GitHub 细粒度令牌。');
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),15000);
    try {await verifyReviewRepository(token,abort.signal);}
    finally {clearTimeout(timeout);}
    const next={token,device:connection?.device??crypto.randomUUID()};
    storeReviewConnection(next);
    setConnection(next);
    setStatus({mode:'waiting',message:''});
  };
  const disconnect=()=>{
    storeReviewConnection(null);
    latest.current++;
    inFlight.current?.abort();
    lastSynced.current=null;
    setConnection(null);
    setStatus({mode:'waiting',message:''});
  };
  return {connected:!!connection,device:connection?.device,status,connect,disconnect,retry:()=>retryNow(x=>x+1)};
}

export function PrivateReview({review,available}:{review:ReturnType<typeof usePrivateReview>;available:boolean}) {
  const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {connected,device,status}=review;
  const label=status.mode==='success'?'已更新':status.mode==='error'?'未同步':status.mode==='uploading'?'上传中':'等候上传';
  return <section className="private-review" aria-label="私有核对设置">
    <div className="section-heading"><h2>私有核对</h2><Badge tone={connected&&status.mode==='success'?'green':undefined}>{connected?label:'未开启'}</Badge></div>
    <p className="muted">开启后，每次保存会自动发送加密的完整账本副本，供后续核对。各设备仍各自录入，不会从副本回写。</p>
    {connected&&<div className="review-status" aria-live="polite"><strong>{label}</strong> {status.message&&<span>{status.message}</span>}<small className="muted">设备编号：{device?.slice(0,8)} · 副本与本机账本独立</small></div>}
    {(!connected||status.mode==='error')&&available&&<form onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError('');
      try {await review.connect(token.trim());setToken('');}
      catch(error){setError((error as Error).message);}
      finally {setBusy(false);}
    }}>
      <ol className="review-steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 GitHub 细粒度令牌</a></li>
        <li>只授权 <code>{reviewRepository.split('/')[1]}</code>，Contents 设为 Read and write。</li>
        <li>把令牌粘贴在下方。本机保存授权，账本备份不包含令牌。</li>
      </ol>
      <label className="review-token"><span>GitHub 细粒度令牌</span><input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required/></label>
      <button className="button primary small-button" disabled={busy}>{busy?'正在连接…':connected?'更新授权':'开启自动核对'}</button>
    </form>}
    {error&&<p role="alert" className="muted">{error}</p>}
    {connected&&<div className="button-row"><button className="button secondary small-button" disabled={status.mode==='uploading'||!available} onClick={review.retry}>重试上传</button><button className="button secondary small-button" disabled={busy} onClick={()=>{try{review.disconnect();setError('');}catch{setError('无法清除本机授权，请在 GitHub 撤销该令牌。');}}}>关闭自动上传</button></div>}
    {connected&&<p className="muted small">关闭后停止本机上传。已上传的加密副本仍保存在你的私有仓库。</p>}
  </section>;
}
