import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { load } from './domain/storage';
import './styles.css';
const root=createRoot(document.getElementById('root')!);
root.render(<p role="status" style={{padding:32}}>正在打开本地账本…</p>);
void load().then(initial=>root.render(<StrictMode><App initial={initial}/></StrictMode>));
