import { afterEach, expect, it, vi } from 'vitest';
import { initialState } from './seed';
import { publishReviewCopy } from './reviewSync';

afterEach(()=>vi.unstubAllGlobals());
it('即使仓库名称和 ID 都正确，公开仓库也不会收到上传请求',async()=>{
  const fetcher=vi.fn(async()=>Response.json({id:1447139541,full_name:'mnijc19-netizen/shift-pay-private-ledger',private:false,visibility:'public',default_branch:'main'}));
  vi.stubGlobal('fetch',fetcher);
  await expect(publishReviewCopy({token:'github_pat_SYNTHETIC',device:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},initialState(),new AbortController().signal)).rejects.toThrow('私有仓库');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
