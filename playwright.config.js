import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.js',timeout:60000,expect:{timeout:15000},use:{viewport:{width:1280,height:900}}});
