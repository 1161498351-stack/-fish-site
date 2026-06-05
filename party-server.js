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
  const todayGz=d.todayGz||'';
  const baziInfo=bazi?'八字：'+bazi+'（'+wx+'命）'+gender:'无八字信息';
  const gzInfo=todayGz?'今日干支：'+todayGz:'今日干支未提供，只能做一般性解读';
  const sysPrompt='你是一位熟悉传统八字文化的老先生，话不多但句句到位。你只做民俗文化和娱乐性质的运势解读，不做确定性预言。不得给医疗、投资、法律等现实决策建议。表达克制、实在，不吓唬用户。';
  let userPrompt;
  if(mode==='today'){
    userPrompt='请为「'+name+'」推算今日运势。\n\n'+baziInfo+'\n'+gzInfo+'\n\n请严格按以下格式输出：\n【今日总评】一句话\n【干支关系】今日干支与命主日柱的关系\n【运势评级】★☆☆☆☆ ~ ★★★★★\n【事业】一句话\n【人际】一句话\n【健康】一句话\n【今日宜】两项\n【今日忌】两项\n【一句话】结尾鼓励\n\n如果信息不足，不要编造，请明确说明。控制在250字以内。';
  }else{
    userPrompt='请为「'+name+'」做八字整体分析。\n\n'+baziInfo+'\n\n请严格按以下格式输出：\n【命局特点】日主强弱与格局简述\n【五行喜忌】最需/最忌的五行\n【事业方向】2-3个适合方向（仅为民俗参考）\n【财运特征】简述（仅为民俗参考）\n【感情提示】简述（仅为民俗参考）\n【健康关注】简述（仅为民俗参考）\n【当前大运】简述\n【人生建议】一句话\n\n注意：每项都要加"仅为民俗文化参考，不构成现实建议"。语言实在，不故弄玄虚，控制在350字以内。';
  }
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:0.7,max_tokens:mode==='today'?500:700});
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
        res.end(JSON.stringify({code:200,data:{text:'今日卦象未显。但天道酬勤，心诚自有好报。',mode:mode}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'网络暂未通。不妨先喝杯茶，天机不在一时。',mode:mode}}));
  });
  apiReq.write(body);apiReq.end();
}

function aiCowrite(d,res){
  const story=d.story||'',title=d.title||'未命名',style=d.style||'自由';
  const pov=d.pov||'未指定',characters=d.characters||'未指定',setting=d.setting||'未指定';
  const minWords=d.minWords||200,maxWords=d.maxWords||500;
  const sysPrompt='你是职业小说作者，擅长续写。写作原则：1.少用形容词，多用动作和细节。2.不总结，不解释，不评价，只输出小说正文。3.不突然改变人称、视角、时代背景和人物关系。4.不随意引入重要新角色。5.不一次性解开核心悬念，只推进一小步。6.保持上文语气和节奏。';
  const userPrompt='故事类型：'+style+'\n叙事人称：'+pov+'\n主要人物：'+characters+'\n已知设定：'+setting+'\n\n已写内容：\n---\n'+story+'\n---\n\n续写要求：1.承接上文情绪和动作 2.加入一处感官细节 3.对话符合人物状态 4.保持节奏 5.结尾留轻微悬念\n\n字数：'+minWords+'-'+maxWords+'字。禁止：改变人称视角、引入新主要角色、总结剧情、写"本章完"之类的结束语。只输出续写正文。';
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:0.85,max_tokens:Math.ceil(maxWords*2.5)});
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
        res.end(JSON.stringify({code:200,data:{text:'（AI暂时无法回应，请稍后再试）'}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'（网络暂不通，请稍后重试）'}}));
  });
  apiReq.write(body);apiReq.end();
}

function buildPersonaSummary(chatHistory){
  if(!chatHistory||chatHistory.length<4)return '对话刚开始，尚无足够信息。';
  var userMsgs=chatHistory.filter(function(m){return m.role==='user'}).map(function(m){return m.content});
  return userMsgs.slice(-8).map(function(m,i){return (i+1)+'. '+m}).join('\n');
}

function aiPersonality(d,res){
  const chatHistory=d.chatHistory||[],name=d.name||'朋友',mode=d.mode||'chat';
  const summary=buildPersonaSummary(chatHistory);
  var recent=chatHistory.slice(-20);
  var recentText=recent.map(function(m){return (m.role==='ai'?'助手':'用户')+': '+m.content}).join('\n');
  var shortCount=0;
  for(var i=recent.length-1;i>=0;i--){
    if(recent[i].role==='user'&&recent[i].content.length<5)shortCount++;else break;
  }

  const sysPrompt='你是一个有好奇心、善于观察的聊天伙伴。你的目标是通过自然对话了解一个人。原则：真诚、灵活、不套路。你像是一个善于倾听的朋友，而不是在做问卷调查。不要编造用户没说过的话。不要做心理诊断。';
  let userPrompt,temperature,maxTokens;

  if(mode==='start'){
    temperature=0.85;maxTokens=200;
    userPrompt='你将和'+name+'开始一段对话。自然地打个招呼，简短介绍自己（你是喜欢通过聊天了解人的观察者），然后根据对方的反应灵活聊下去。不要用模板化的开场白，不要像客服。像认识新朋友一样。可以分享一点自己的风格，让对方感觉你在认真对待这次对话。';
  }else if(mode==='report'){
    temperature=0.55;maxTokens=1200;
    userPrompt='以下是和'+name+'的完整对话。请基于对话内容生成一份人格观察报告。\n\n对话记录：\n'+recentText+'\n\n报告格式：\n【整体印象】你对这个人的直观感受（2-3句话）\n【性格特征】从对话中观察到的性格特点，每条都要引用对话原话作为依据\n【MBTI倾向】推测可能的类型倾向（注意：只写倾向，不写确定结论。证据不足就说不足）\n【优势与盲区】基于对话的观察\n【证据不足的地方】明确列出哪些方面信息不够\n\n核心要求：只能基于对话中实际出现的内容。不要编造。不要把倾向写成结论。语气像一个有洞察力的朋友在分享观察，不要像诊断报告。';
  }else{
    temperature=0.85;maxTokens=250;
    var shortHint='';
    if(shortCount>=2)shortHint='\n\n注意：对方已经连续简短回复了几次。不要继续在同一个方向上追问。自然地换个话题，或者分享一点相关的个人观察来打破僵局。保持轻松，不要施压。';
    userPrompt='以下是和'+name+'的对话记录：\n\n'+recentText+shortHint+'\n\n你现在作为聊天伙伴，回复对方最后一条消息。要求：\n- 像朋友聊天一样自然，不要模板化\n- 根据对方说的话灵活回应，可以追问、可以共鸣、可以分享观点\n- 如果对方说得多就深入聊，说得少就换个方向轻轻试探\n- 不要连续在同一个话题上追问\n- 不要使用"最近怎么样""有什么新鲜事"这类空洞的万能问题\n- 不要评价对方回答的好坏（如"挺好的""不错啊"）\n- 不要做人格判断（如"你看起来是一个XX的人"）';
  }
  const body=JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sysPrompt},{role:'user',content:userPrompt}],temperature:temperature,max_tokens:maxTokens});
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
        res.end(JSON.stringify({code:200,data:{text:'（让我想想…）'}}));
      }
    });
  });
  apiReq.on('error',()=>{
    res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({code:200,data:{text:'（网络不太稳，稍等一下）'}}));
  });
  apiReq.write(body);apiReq.end();
}

function checkAllDescribed(room){function checkAllDescribed(room){
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
