import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({root:'web',css:{postcss:{plugins:[]}},build:{outDir:'../public',emptyOutDir:true,rollupOptions:{input:{main:resolve('web/index.html'),audit:resolve('web/business-audit.html'),sales:resolve('web/sales.html')}}},server:{host:'127.0.0.1',port:5175,proxy:{'/api':'http://127.0.0.1:8790','/agents':{target:'ws://127.0.0.1:8790',ws:true}}}});
