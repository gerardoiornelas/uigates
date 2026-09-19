#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, save } from './storage/file.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const [command='help',json='{}']=process.argv.slice(2);
try {
  const available=fs.readdirSync(path.join(root,'features')).filter(f=>f.endsWith('.mjs')).map(f=>f.slice(0,-4)).sort();
  if(command==='help')console.log('Workboard — local project tracking\nUsage: node cli.mjs COMMAND JSON\nCommands: '+available.join(', '));
  else {
    if(!available.includes(command))throw Error('unknown command');
    const input=JSON.parse(json),file=path.resolve(process.env.WORKBOARD_FILE??'.workboard.json'),board=load(file),before=JSON.stringify(board);
    const {run}=await import(pathToFileURL(path.join(root,'features',command+'.mjs')));
    const result=await run(board,input);if(JSON.stringify(board)!==before)save(file,board);
    console.log(JSON.stringify(result,null,2));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
