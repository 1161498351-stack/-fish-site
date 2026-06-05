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
      try{const d=JSON.parse(body);aiPersonality(d,res,req);}
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

  // 聊天日志查看
  if(url==='/chat-logs'&&req.method==='GET'){
    var pw=new URL(req.url,'http://x').searchParams.get('pw')||'';
    if(pw!=='moyu666'){res.writeHead(403);res.end('403');return;}
    try{
      var lf=path.join(ROOT,'chat-logs.json');
      var ld=JSON.parse(fs.readFileSync(lf,'utf8'));
      res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
      var h='<h2>聊天记录</h2><table border=1 cellpadding=4><tr><th>时间</th><th>IP</th><th>昵称</th><th>模式</th><th>消息数</th></tr>';
      for(var i=ld.length-1;i>=Math.max(0,ld.length-200);i--){
        h+='<tr><td>'+ld[i].time+'</td><td>'+ld[i].ip+'</td><td>'+ld[i].name+'</td><td>'+ld[i].mode+'</td><td>'+ld[i].msgCount+'</td></tr>';
      }
      h+='</table>';res.end(h);
    }catch(e){res.writeHead(500);res.end('无记录');}
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
  const sysPrompt='你是庙里解签的老先生，文采好、有禅意。你写的签诗有意境，签文有智慧，不吓人、不说教。你只做民俗文化娱乐解读，不给医疗投资法律建议。';
  let userPrompt;
  if(mode==='today'){
    userPrompt='请为「'+name+'」写一支今日运势签。\n\n'+baziInfo+'\n'+gzInfo+'\n\n请输出：\n【签文】四行七言签诗，有意境有韵味，像庙里真签\n【签名】四个字（如"青龙得位""紫气东来"）\n【签等】上上 / 上 / 中吉 / 中 / 中平 / 下\n【解读】80字内白话解读今日运势，温暖有趣，像老友叮嘱。可以提今日宜做什么、忌做什么\n【寄语】一句走心的话\n\n如果信息不足不要编造。注意：签诗要像诗，不要大白话。';
  }else{
    userPrompt='请为「'+name+'」批一支人生签。\n\n'+baziInfo+'\n\n请输出：\n【签文】四行七言签诗，概括此生命局特点\n【签名】四个字\n【命局解读】100字内白话解读命局特点和人生走势，像老先生聊天，不故弄玄虚\n【人生建议】一句有禅意的话\n\n仅供民俗文化娱乐参考。';
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

function aiPersonality(d,res,req){
  const chatHistory=d.chatHistory||[],name=d.name||'朋友',mode=d.mode||'chat';
  // 记录 IP 和聊天数据
  if(mode==='chat'||mode==='start'){
    var ip=req.headers['x-forwarded-for']||req.socket.remoteAddress||'未知';
    var log={time:new Date().toISOString(),ip:ip,name:name,mode:mode,msgCount:chatHistory.length};
    try{
      var logFile=path.join(ROOT,'chat-logs.json');
      var logs=[];
      try{logs=JSON.parse(fs.readFileSync(logFile,'utf8'));}catch(e){}
      logs.push(log);
      if(logs.length>10000)logs=logs.slice(-5000); // 最多保留5000条
      fs.writeFileSync(logFile,JSON.stringify(logs,null,2));
    }catch(e){}
  }
  const summary=buildPersonaSummary(chatHistory);
  var recent=chatHistory.slice(-20);
  var recentText=recent.map(function(m){return (m.role==='ai'?'助手':'用户')+': '+m.content}).join('\n');
  var shortCount=0;
  for(var i=recent.length-1;i>=0;i--){
    if(recent[i].role==='user'&&recent[i].content.length<5)shortCount++;else break;
  }

  const sysPrompt='你是人格观察AI。你的目标是通过对话收集用户的多维度信息来生成分析报告。收集维度：工作、兴趣、社交、价值观、压力应对、生活态度。\n\n对话风格：\n- 真诚、简洁，不假装人类\n- 每次只问一个问题，不连珠炮\n- 用户简短回应时追问一句确认，然后自然换方向\n- 不编造自己的经历，不评价用户回答的好坏\n- 对话已经开始后，不要再自我介绍，直接回应上一句话';
  let userPrompt,temperature,maxTokens;

  var messages=[{role:'system',content:sysPrompt}];
  if(mode==='start'){
    temperature=0.85;maxTokens=300;
    messages.push({role:'user',content:'你好！我叫'+name+'。请开始我们的对话。'});
  }else if(mode==='report'){
    temperature=0.55;maxTokens=2000;
    // 把对话历史作为原生messages
    for(var i=0;i<chatHistory.length;i++){
      messages.push({role:chatHistory[i].role==='ai'?'assistant':'user',content:chatHistory[i].content});
    }
    // 注入前端匹配到的推理规则
    var kbHints=d.kbHints||[];
    var kbText='';
    if(kbHints.length>0){
      kbText='\n\n以下是从知识库中匹配到的推理规则，供参考：\n';
      for(var k=0;k<kbHints.length;k++){
        var r=kbHints[k];
        kbText+='\n信号：'+r.signal.join('、')+'\n  → 可能解释：'+r.meanings.join(' / ')+'\n  → 不能直接判断为：'+r.not.join(' / ')+'\n  → 建议追问：'+r.ask.join(' / ')+'\n';
      }
    }
    // 报告焦点
    var focus=d.focus||'all';
    var focusGuide={all:'做全面分析，覆盖工作、感情、生活、压力等各方面',
      career:'重点分析职业倾向、工作风格、成就动机、适合的工作环境和职业方向',
      love:'重点分析关系模式、依恋倾向、社交偏好、亲密关系中的需求和边界',
      life:'重点分析价值观排序、生活哲学、意义感来源、理想生活画面',
      stress:'重点分析压力来源、应对机制、恢复方式、情绪调节模式'};
    var focusText=focusGuide[focus]||focusGuide.all;
    messages.push({role:'user',content:'基于以上对话，生成人格观察报告。\n\n用户选择了报告焦点：'+focusText+'\n请聚焦这个方向深入分析，其他维度可以简要提及或不提。\n\n核心原则：\n- 你不是在诊断，是在观察。每个判断必须配证据、替代解释、置信度。\n- 单次表达=低置信度，多次重复+被确认=中置信度，明确自述=高置信度。\n- 禁止从单一信号直接跳到人格结论。\n- 不确定就说不确定。\n'+kbText+'\n请按以下格式输出：\n\n【核心观察】2-3句话概括\n\n【逐条分析】每条按格式：\n观察点 → 证据（引用原话）→ 可能解释（2-3种）→ 不能直接判断 → 后续可确认\n\n【模式关联】\n\n【置信度说明】高/中/低\n\n【未覆盖区域】\n\n【下一步建议】\n\n【综合判断】基于以上所有观察，运用心理学框架做整合结论。不是重复清单，而是回答一个问题：这个人的心理状态和行为模式，整体上到底是怎么样的？用专业但不生硬的语言，像一位有经验的心理观察者在做总结。250字以上。'});
  }else{
    temperature=0.85;maxTokens=400;
    // 把对话历史作为原生messages，模型能理解对话结构
    for(var i=0;i<chatHistory.length;i++){
      messages.push({role:chatHistory[i].role==='ai'?'assistant':'user',content:chatHistory[i].content});
    }
    var dims=['工作状态','兴趣偏好','社交风格','价值观','压力应对','生活态度'];
    var uncovered=[];
    for(var i=0;i<dims.length;i++){if(recentText.indexOf(dims[i])<0)uncovered.push(dims[i]);}
    var hint=uncovered.length>0?'尚未触及的维度：'+uncovered.join('、')+'' :'';
    messages.push({role:'user',content:(hint?'[待覆盖维度：'+hint+'] ':'')+'回应上一条。记住你的最终任务是为综合判断收集足够素材——不只是表面偏好，而是一个人的行为模式、内心逻辑、情感反应方式。深度优先，追问"为什么"比切换话题更重要。当信息足够形成有深度的结论时，自然告诉对方可以试试生成报告。'});
  }
  const body=JSON.stringify({model:'deepseek-chat',messages:messages,temperature:temperature,max_tokens:maxTokens});
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
