// 联机游戏服务器 — 谁是卧底 + AI算命
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');

const PORT=process.env.PORT||8899,ROOT=__dirname;
const MIME={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
const DS_KEY=(process.env.DS_KEY||'').trim()||(function(){try{return fs.readFileSync(path.join(__dirname,'key.txt'),'utf8').trim()}catch(e){return''}})();

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
    req.setEncoding('utf8');
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{const d=JSON.parse(body);aiFortune(d,res);}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:'请求格式错误'}));}
    });
    return;
  }

  // 人格分析 API
  if(req.method==='POST'&&url==='/api/personality'){
    req.setEncoding('utf8');
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{const d=JSON.parse(body);aiPersonality(d,res);}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:'请求格式错误'}));}
    });
    return;
  }

  // AI 共创小说 API
  if(req.method==='POST'&&url==='/api/cowrite'){
    req.setEncoding('utf8');
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{const d=JSON.parse(body);aiCowrite(d,res);}
      catch(e){res.writeHead(400);res.end(JSON.stringify({error:'请求格式错误'}));}
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
  const name=d.name||'有缘人',wx=d.wuxing||'未知',bazi=d.bazi||'',gender=d.gender||'',mode=d.mode||'today';
  const baziInfo=bazi?'八字：'+bazi+'（'+wx+'命）'+gender:'无八字信息';
  let sysPrompt,userPrompt;
  if(mode==='today'){
    sysPrompt='你是一位精通八字命理和择日学的老先生。你根据一个人的八字日柱和当天干支，推算当日运势。你的风格：像庙里解签的老先生，话不多但句句到位。';
    userPrompt='请为「'+name+'」推算今日运势。'+baziInfo+'\n\n要求：\n1. 先看今日干支与命主日柱的生克关系\n2. 给出今日运势评级（大吉/吉/平/凶）\n3. 分析今日事业、人际、健康三个方面的注意事项\n4. 给出今日宜忌（各2条）\n5. 最后送一句鼓励的话\n6. 控制在200字以内，语言简洁有力，不要太啰嗦';
  }else{
    sysPrompt='你是一位精通八字命理的老先生，有三十年批命经验。你根据一个人的八字格局、五行喜忌、大运走势，给出整体人生分析。你的风格：直率、深刻、不故弄玄虚，像褚时健那种实在的老辈人。';
    userPrompt='请为「'+name+'」做八字整体分析。'+baziInfo+'\n\n要求：\n1. 分析日主强弱和格局特点（50字内）\n2. 五行喜忌：最需要的五行和最需要避开的五行\n3. 事业方向：适合的行业和岗位类型（2-3个方向）\n4. 财运特点：正财还是偏财，适合的投资风格\n5. 感情婚姻：需要注意的方面\n6. 健康提示：需要关注的方面\n7. 当前大运简析\n8. 总结一句人生建议\n\n语言要实在，不要假大空，像在给自家孩子讲实话。控制在400字以内。';
  }
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:0.8,max_tokens:mode==='today'?500:800});
  const apiReq=https.request({hostname:'api.deepseek.com',path:'/chat/completions',method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+DS_KEY}},apiRes=>{
    let data='';apiRes.on('data',c=>data+=c);
    apiRes.on('end',()=>{
      try{
        const j=JSON.parse(data);
        const content=j.choices[0].message.content.trim();
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:{text:content,mode:mode}}));
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
        res.end(JSON.stringify({code:200,data:{text:'今日卦象未显，天机不可轻泄。但天道酬勤，心诚自有好报。',mode:mode}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'网络未通，但天机不在一时。静下来问问自己的心，答案一直在你心里。',mode:mode}}));
  });
  apiReq.write(body);apiReq.end();
}

function aiCowrite(d,res){
  const story=d.story||'',title=d.title||'未命名',style=d.style||'自由';
  const sysPrompt='你是一位出版过多部畅销小说的职业作家。你的文字有强烈的画面感和节奏感，擅长用简洁有力的白描和生动的对话推进情节。你的写作信条是：少用形容词，多用动词；少抒情议论，多展示细节；每个段落都应该要么推进剧情，要么揭示人物。';
  const userPrompt='我们正在合写一篇小说。\n\n标题：《'+title+'》\n风格方向：'+style+'\n\n已写内容：\n---\n'+story+'\n---\n\n请你接着往下写一段（150-400字）。要求：\n1. 开头直接承接上文最后一句话的情绪或动作\n2. 至少包含一处生动的感官细节（声音/气味/触感/光线）\n3. 如果有对话，每句话都要符合说话人的性格\n4. 段落要有节奏感——短句制造紧张，长句营造氛围\n5. 在情节转折点或人物内心波动处停笔，留悬念\n6. 语言要干净利落，删掉所有可有可无的字\n7. 只输出续写内容，不要任何说明';
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:0.9,max_tokens:600});
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

function aiPersonality(d,res){
  const history=d.history||[],name=d.name||'朋友',mode=d.mode||'chat';
  const sysPrompt='你是一位资深心理学专家，精通MBTI、大五人格等分析工具。你通过轻松自然的聊天来了解一个人，而不是做问卷。你的风格：温暖、不评判，像一位有阅历的朋友。铁律：①永远不要编造用户没说过的话，不要假设用户喜欢什么、有什么经历。②不确定某个话题用户是否聊过时，直接问，别脑补。③每次只问一件事，2-3句话，不要长篇大论。④如果用户纠正你的误解，立刻道歉并调整。你要逐步了解：工作状态、人际关系、压力应对、价值观、理想生活，但要自然引导，不要审问。';
  let userPrompt;
  if(mode==='start'){
    userPrompt='我是'+name+'。打个招呼，简单介绍你自己（一句话），然后问我一个关于日常生活或工作的小问题。语气随意，像微信上认识新朋友，别说什么"让我们开始人格探索之旅"这种尬话。';
  }else if(mode==='report'){
    userPrompt='基于我们的聊天记录，请给我一份详细的人格分析报告。务必引用对话中的原话来支撑你的分析。格式如下：\n\n【性格画像】用3-5个关键词概括，每个词配一句解释，尽量引用对话原话\n\n【MBTI推测】推测类型并解释，引用对话中的具体表现\n\n【优势领域】工作/人际/创造力等，结合对话中提到的实际情况\n\n【潜在盲区】2-3个可能需要留意的地方\n\n【成长建议】3条具体可行的建议\n\n【适合职业】推荐3-5个职业方向并解释原因\n\n【关系模式】在亲密关系和职场关系中可能的特点\n\n聊天记录：\n'+history.map(function(m){return m.role+': '+m.content}).join('\n')+'\n\n请生成报告，语言温暖真诚，引用对话原话时标出。';
  }else{
    userPrompt='对话历史：\n'+history.map(function(m){return m.role+': '+m.content}).join('\n')+'\n\n回应规则：\n1. 对话已经开始了，绝对不要重新自我介绍或打招呼\n2. 如果用户回答很短（"没有""还行""不知道"），不要慌——可以换个角度追问，比如"那你平时怎么打发时间？"或者聊点轻松的\n3. 如果用户说了具体的内容，就顺着往下聊，不要突然换话题\n4. 不要替用户编造经历，不确定就直接问\n5. 语气像微信上跟朋友闲聊，简短自然，一次只说一件事';
  }
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:0.8,max_tokens:mode==='report'?1500:300});
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
        res.end(JSON.stringify({code:200,data:{text:'（让我想想…重新组织一下语言）'}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'（网络不太稳定，稍等一下再试）'}}));
  });
  apiReq.write(body);apiReq.end();
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
