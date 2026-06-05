// 联机游戏服务器 — 谁是卧底 + AI算命
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');

const PORT=process.env.PORT||8899,ROOT=__dirname;
const MIME={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
const DS_KEY=process.env.DS_KEY||(function(){try{return fs.readFileSync(path.join(__dirname,'key.txt'),'utf8').trim()}catch(e){return''}})();

// ═══════ 游戏状态 ═══════
const rooms=new Map(); // roomId -> {players:{id,name,role,word,ready,alive,votes},host,status:'waiting'|'playing'|'voting'|'end',round,wordPair}

// 词语库
const WORD_PAIRS=[
  ['包子','饺子'],['牛奶','豆浆'],['空调','风扇'],['手机','平板'],['西瓜','哈密瓜'],
  ['老师','教授'],['律师','法官'],['医生','护士'],['警察','保安'],['演员','歌手'],
  ['键盘','鼠标'],['眼镜','墨镜'],['雨伞','遮阳伞'],['枕头','抱枕'],['拖鞋','凉鞋'],
  ['蛋糕','面包'],['啤酒','白酒'],['篮球','排球'],['地铁','轻轨'],['电梯','扶梯'],
  ['眉毛','睫毛'],['围巾','披肩'],['番茄','柿子'],['土豆','红薯'],['海绵','泡沫'],
];

// ═══════ HTTP 服务 ═══════
const server=http.createServer((req,res)=>{
  let url=req.url.split('?')[0];

  // AI 算命 API
  if(req.method==='POST'&&url==='/api/fortune'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{const d=JSON.parse(body);aiFortune(d,res);}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:'参数错误',len:body.length,raw:body.slice(0,50)}));}
    });
    return;
  }

  // AI 共创小说 API
  if(req.method==='POST'&&url==='/api/cowrite'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{const d=JSON.parse(body);aiCowrite(d,res);}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:'参数错误',len:body.length,raw:body.slice(0,50)}));}
    });
    return;
  }

  // 阻止访问敏感文件
  if(/\/key\.txt|\.env|party-server\.js|\.git/i.test(url)){res.writeHead(403);res.end('403');return;}
  if(url==='/')url='/index.html';
  const fp=path.join(ROOT,decodeURIComponent(url));
  const ext=path.extname(fp).toLowerCase();
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);res.end('404');return}
    res.writeHead(200,{'Content-Type':MIME[ext]||'text/plain'});
    res.end(data);
  });
});

function aiFortune(d,res){
  const name=d.name||'有缘人',wx=d.wuxing||'未知',bazi=d.bazi||'',gender=d.gender||'';
  const baziStr=bazi?`\n八字：${bazi}（${wx}命）${gender?'，'+gender:''}`:'';

  const prompt=`你是一位精通周易、八字命理和传统文化的老先生。请为「${name}」写一支事业运势灵签。${baziStr}

要求：
1. 一支四行签诗（七言绝句风格，押韵更好），签诗要有意境，每行七个字
2. 签名（四个字，如"青龙得位"），要像真正的庙签
3. 签等（上上/上/中吉/中/中平/下）
4. 一段150字左右的白话事业解读，结合八字五行，有具体建议，语气温暖像老友谈心
5. 一句行动建议（宜/忌 格式）

请严格按以下JSON格式回复，不要有其他内容：
{"sign":"签名","level":"签等","poem":"签诗\\n换行","reading":"解读内容","advice":"建议"}`;

  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.9,max_tokens:800});
  const apiReq=https.request({hostname:'api.deepseek.com',path:'/chat/completions',method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+DS_KEY}},apiRes=>{
    let data='';apiRes.on('data',c=>data+=c);
    apiRes.on('end',()=>{
      try{
        const j=JSON.parse(data);
        const content=j.choices[0].message.content;
        // 尝试从回复里提取 JSON
        const m=content.match(/\{[\s\S]*\}/);
        const r=JSON.parse(m?m[0]:content);
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:r}));
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:{sign:'天机不可泄',level:'中',poem:'天机浩渺不可测\\n人事纷繁自有涯\\n但行好事莫问程\\n春风送暖入君家',reading:'今日卦象未显，天机不可轻泄。但天道酬勤，只要心诚自有好报。不妨稍后再试，或先摇一支签。',advice:'宜：心诚则灵 · 静待天时'}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{sign:'网络未通',level:'中',poem:'网络迢迢路未通\\n暂凭旧卦问西东\\n世间万事皆天定\\n何必急在一时中',reading:'网络暂时不通，但天机不在一时。你当下最需要的不是一支签，而是静下来问问自己的心。答案一直在你心里。',advice:'宜：稍后再试 · 先喝杯茶'}}));
  });
  apiReq.write(body);apiReq.end();
}

function aiCowrite(d,res){
  const story=d.story||'',title=d.title||'未命名',style=d.style||'自由';
  const prompt=`你是一位中文小说家，正在和朋友一起写小说。

标题：《${title}》
风格：${style}

已写内容：
---
${story}
---

请你接着往下写一段（200-400字）。注意：
1. 用口语化的中文，像正常人说话那样自然，不要翻译腔
2. 多写对话和动作，少写抽象抒情
3. 可以推进剧情，也可以揭示人物内心
4. 在有意思的地方停笔，让对方想接着写
5. 只输出续写文字，别加"以下是续写"之类的废话`;
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:prompt}],temperature:0.85,max_tokens:800});
  const apiReq=https.request({hostname:'api.deepseek.com',path:'/chat/completions',method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+DS_KEY}},apiRes=>{
    let data='';apiRes.on('data',c=>data+=c);
    apiRes.on('end',()=>{
      try{
        const j=JSON.parse(data);
        const content=j.choices[0].message.content.trim();
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:{text:content}}));
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:{text:'（AI暂时无法回应，请稍后再试，或继续往下写吧。）'}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'（网络暂时不通，请检查API连接后重试。）'}}));
  });
  apiReq.write(body);apiReq.end();
}

// ═══════ WebSocket ═══════
const clients=new Map(); // ws -> {id,roomId,playerId}

server.on('upgrade',(req,socket,head)=>{
  const key=req.headers['sec-websocket-key'];
  if(!key){socket.destroy();return}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');

  const ws={socket,buffer:''};
  clients.set(socket,ws);

  socket.on('data',data=>{
    let msg=parseWS(data);
    if(!msg)return;
    try{msg=JSON.parse(msg);}catch(e){return}
    handleMsg(ws,msg);
  });

  socket.on('close',()=>{const c=clients.get(socket);if(c)leaveRoom(c);clients.delete(socket);});
  socket.on('error',()=>{});
});

function parseWS(data){
  const b=data[0],b2=data[1];
  if((b2&0x80)===0)return null;
  const len=b2&0x7f;
  let offset=2,mlen=len;
  if(len===126){mlen=data.readUInt16BE(2);offset=4;}
  else if(len===127){mlen=Number(data.readBigUInt64BE(2));offset=10;}
  const mask=data.slice(offset,offset+4);offset+=4;
  const payload=data.slice(offset,offset+mlen);
  for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
  return payload.toString('utf8');
}

function sendWS(socket,obj){
  const json=Buffer.from(JSON.stringify(obj),'utf8');
  const len=json.length;
  let head;
  if(len<126){head=Buffer.alloc(2);head[0]=0x81;head[1]=len;}
  else if(len<65536){head=Buffer.alloc(4);head[0]=0x81;head[1]=126;head.writeUInt16BE(len,2);}
  else{head=Buffer.alloc(10);head[0]=0x81;head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}
  socket.write(Buffer.concat([head,json]));
}

function broadcast(room,obj,exclude=null){
  for(const[id,p]of Object.entries(room.players)){
    if(p.ws&&p.ws!==exclude)sendWS(p.ws.socket,obj);
  }
}

// ═══════ 消息处理 ═══════
function handleMsg(ws,msg){
  const {type}=msg;
  if(type==='create'){createRoom(ws,msg.name);}
  else if(type==='join'){joinRoom(ws,msg.roomId,msg.name);}
  else if(type==='start'){startGame(ws);}
  else if(type==='ready'){playerReady(ws);}
  else if(type==='describe'){playerDescribe(ws,msg.text);}
  else if(type==='vote'){playerVote(ws,msg.targetId);}
  else if(type==='restart'){restartGame(ws);}
}

function genId(){return Math.random().toString(36).slice(2,8).toUpperCase();}
function genPid(){return 'p'+Math.random().toString(36).slice(2,8);}

function roomInfo(r){
  return{roomId:r.id,host:r.host,status:r.status,round:r.round,
    players:Object.values(r.players).map(p=>({id:p.id,name:p.name,ready:p.ready,alive:p.alive,votes:p.votes||0}))};
}

function createRoom(ws,name){
  const roomId=genId(),playerId=genPid();
  const room={id:roomId,host:playerId,status:'waiting',round:0,wordPair:null,
    players:{[playerId]:{id:playerId,name,role:null,word:null,ready:false,alive:true,votes:0,ws}}};
  rooms.set(roomId,room);
  clients.get(ws.socket).roomId=roomId;
  clients.get(ws.socket).playerId=playerId;
  sendWS(ws.socket,{type:'joined',roomId,playerId,room:roomInfo(room)});
}

function joinRoom(ws,roomId,name){
  const room=rooms.get(roomId);
  if(!room){sendWS(ws.socket,{type:'error',msg:'房间不存在'});return}
  if(room.status!=='waiting'){sendWS(ws.socket,{type:'error',msg:'游戏已开始，无法加入'});return}
  if(Object.keys(room.players).length>=8){sendWS(ws.socket,{type:'error',msg:'房间已满（最多8人）'});return}
  const playerId=genPid();
  room.players[playerId]={id:playerId,name,role:null,word:null,ready:false,alive:true,votes:0,ws};
  clients.get(ws.socket).roomId=roomId;
  clients.get(ws.socket).playerId=playerId;
  sendWS(ws.socket,{type:'joined',roomId,playerId,room:roomInfo(room)});
  broadcast(room,{type:'update',room:roomInfo(room)},ws.socket);
}

function playerReady(ws){
  const c=clients.get(ws.socket);if(!c)return;
  const room=rooms.get(c.roomId);if(!room)return;
  const p=room.players[c.playerId];if(!p)return;
  p.ready=!p.ready;
  broadcast(room,{type:'update',room:roomInfo(room)});
}

function startGame(ws){
  const c=clients.get(ws.socket);if(!c)return;
  const room=rooms.get(c.roomId);if(!room)return;
  if(c.playerId!==room.host){sendWS(ws.socket,{type:'error',msg:'只有房主可以开始'});return}
  let players=Object.values(room.players);
  if(players.length<1){sendWS(ws.socket,{type:'error',msg:'没有玩家'});return}
  // 自动准备所有未准备的人类玩家
  for(const p of players){if(!p.isBot)p.ready=true;}
  if(!players.every(p=>p.ready)){sendWS(ws.socket,{type:'error',msg:'还有人没准备'});return}

  // 不足3人时自动补充机器人
  const botNames=['🤖 机器人小明','🤖 机器人小红','🤖 机器人大壮'];
  while(players.length<3){
    const bpid='bot'+players.length;
    room.players[bpid]={id:bpid,name:botNames[players.length-1],role:null,word:null,
      ready:true,alive:true,votes:0,ws:null,isBot:true};
    players=Object.values(room.players);
  }

  // 分配身份
  const pair=WORD_PAIRS[Math.floor(Math.random()*WORD_PAIRS.length)];
  room.wordPair=pair;
  const spyIdx=Math.floor(Math.random()*players.length);
  players.forEach((p,i)=>{
    p.role=i===spyIdx?'spy':'civilian';
    p.word=i===spyIdx?pair[1]:pair[0];
    p.alive=true;p.votes=0;p.described=false;p.description='';
  });
  room.status='describing';room.round=1;

  // 通知真人玩家身份
  for(const p of players){
    if(p.ws)sendWS(p.ws.socket,{type:'role',role:p.role,word:p.word});
  }
  broadcast(room,{type:'update',room:roomInfo(room)});
  broadcast(room,{type:'phase',phase:'describe',round:1});
}

function playerDescribe(ws,text){
  const c=clients.get(ws.socket);if(!c)return;
  const room=rooms.get(c.roomId);if(!room)return;
  const p=room.players[c.playerId];if(!p||!p.alive)return;
  p.description=(text||'').slice(0,50);p.described=true;
  // 实时广播这条描述给所有人（聊天窗）
  broadcast(room,{type:'chat',name:p.name,text:p.description,playerId:p.id});
  broadcast(room,{type:'update',room:roomInfo(room)});

  // 机器人自动描述（每个机器人延迟一点，模拟真人在打字）
  const alive=Object.values(room.players).filter(x=>x.alive);
  const bots=alive.filter(x=>x.isBot&&!x.described);
  const botDescs=['这个东西很常见','日常生活中经常遇到','大家应该都见过','说不上来但都知道','感觉就在身边'];
  for(let i=0;i<bots.length;i++){
    const bot=bots[i];
    bot.description=botDescs[i]||'这个不好说啊';bot.described=true;
    // 延迟广播机器人的描述
    const delay=800+i*1200;
    setTimeout(()=>{
      broadcast(room,{type:'chat',name:bot.name,text:bot.description,playerId:bot.id});
      // 检查是否全部描述完毕
      const curAlive=Object.values(room.players).filter(x=>x.alive);
      if(curAlive.every(x=>x.described)&&room.status==='describing'){
        room.status='voting';
        broadcast(room,{type:'update',room:roomInfo(room)});
        const descList=curAlive.map(x=>({name:x.name,desc:x.description}));
        broadcast(room,{type:'phase',phase:'vote',round:room.round,descriptions:descList});
      }
    },delay);
  }

  // 如果没有机器人需要处理，立即检查是否全部描述完毕
  if(bots.length===0){
    checkAllDescribed(room);
  }
}

function checkAllDescribed(room){
  const alive=Object.values(room.players).filter(x=>x.alive);
  if(alive.every(x=>x.described)&&room.status==='describing'){
    room.status='voting';
    broadcast(room,{type:'update',room:roomInfo(room)});
    const descList=alive.map(x=>({name:x.name,desc:x.description}));
    broadcast(room,{type:'phase',phase:'vote',round:room.round,descriptions:descList});
  }
}

function playerVote(ws,targetId){
  const c=clients.get(ws.socket);if(!c)return;
  const room=rooms.get(c.roomId);if(!room)return;
  const voter=room.players[c.playerId];
  if(!voter||!voter.alive)return;

  // 计票
  if(targetId&&room.players[targetId]&&room.players[targetId].alive){
    room.players[targetId].votes=(room.players[targetId].votes||0)+1;
  }

  // 机器人自动投票
  const alive=Object.values(room.players).filter(p=>p.alive);
  const bots=alive.filter(p=>p.isBot&&!p.voted);
  for(const bot of bots){
    bot.voted=true;
    const targets=alive.filter(p=>p.id!==bot.id);
    if(targets.length){const t=targets[Math.floor(Math.random()*targets.length)];t.votes=(t.votes||0)+1;}
  }

  // 检查是否所有人投完
  const totalVotes=alive.reduce((s,p)=>s+(p.votes||0),0);
  if(totalVotes<alive.length)return; // 还有人没投

  // 找最高票
  let maxVotes=0,eliminated=[];
  for(const p of alive){if((p.votes||0)>maxVotes)maxVotes=p.votes||0;}
  for(const p of alive){if((p.votes||0)===maxVotes)eliminated.push(p);}

  // 平票不淘汰
  let elimMsg='';
  if(eliminated.length===1){
    const e=eliminated[0];
    e.alive=false;
    elimMsg=e.name+' 被投票出局！';
    if(e.role==='spy'){
      room.status='end';
      broadcast(room,{type:'result',win:'civilian',msg:'卧底「'+e.name+'」被揪出来了！平民胜利！',wordPair:room.wordPair});
      return;
    }
  }else{
    elimMsg='平票！无人出局';
  }

  // 检查卧底是否赢了
  const remaining=Object.values(room.players).filter(p=>p.alive);
  const spiesLeft=remaining.filter(p=>p.role==='spy');
  if(spiesLeft.length===0||(remaining.length<=2&&spiesLeft.length>=1)){
    room.status='end';
    broadcast(room,{type:'result',win:'spy',msg:'卧底存活到最后！卧底胜利！',wordPair:room.wordPair});
    return;
  }

  // 下一轮
  for(const p of Object.values(room.players)){p.votes=0;p.voted=false;}
  room.round++;
  broadcast(room,{type:'update',room:roomInfo(room)});
  broadcast(room,{type:'phase',phase:'describe',round:room.round,elimMsg});
}

function restartGame(ws){
  const c=clients.get(ws.socket);if(!c)return;
  const room=rooms.get(c.roomId);if(!room)return;
  if(c.playerId!==room.host)return;
  room.status='waiting';room.round=0;room.wordPair=null;
  for(const p of Object.values(room.players)){p.role=null;p.word=null;p.ready=false;p.alive=true;p.votes=0;}
  broadcast(room,{type:'update',room:roomInfo(room)});
  broadcast(room,{type:'phase',phase:'lobby'});
}

function leaveRoom(c){
  const room=rooms.get(c.roomId);if(!room)return;
  // 修复：移除断线玩家（原逻辑 !p 反了，导致玩家永不清理）
  delete room.players[c.playerId];
  if(Object.keys(room.players).length===0){rooms.delete(c.roomId);return}
  if(c.playerId===room.host){const rem=Object.keys(room.players);room.host=rem[0];}
  broadcast(room,{type:'update',room:roomInfo(room)});
}

server.listen(PORT,'0.0.0.0',()=>{
  console.log('🎮 联机游戏服务器启动');
  const ifaces=os.networkInterfaces();
  for(const[,addrs]of Object.entries(ifaces))for(const a of addrs)
    if(a.family==='IPv4'&&!a.internal)console.log('   http://'+a.address+':'+PORT);
  console.log('   http://localhost:'+PORT);
});
