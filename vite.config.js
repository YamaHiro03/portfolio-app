import {defineConfig} from 'vite';
export default defineConfig({build:{target:['safari16','chrome120']},server:{host:'0.0.0.0',port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:3001',changeOrigin:false}}}});
