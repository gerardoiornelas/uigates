import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBoard, validateBoard } from '../domain/board.mjs';
export function load(file) {
  if(!fs.existsSync(file))return createBoard();
  return validateBoard(JSON.parse(fs.readFileSync(file,'utf8')));
}
export function save(file,board) {
  validateBoard(board);const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(board,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
