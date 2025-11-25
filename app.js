/* playBlackJack - single-file game logic
   - Saves to localStorage
   - Starts with $10,000, resets to $2,500 when balance reaches 0
   - Provides animations via DOM/CSS and simple SFX via WebAudio
*/
(function(){
  const START_BALANCE = 10000;
  const RESCUE_BALANCE = 2500;
  const SAVE_KEY = 'playBlackJack.save';
  const LEGACY_SAVE_KEY = 'playBlackJack.save.v1';
  const LB_KEY = 'playBlackJack.leaderboard.v1';

  // DOM
  const menu = document.getElementById('main-menu');
  const gameScreen = document.getElementById('game-screen');
  const btnPlay = document.getElementById('btn-play');
  const btnLoad = document.getElementById('btn-load');
  const btnReset = document.getElementById('btn-reset');
  const btnBack = document.getElementById('btn-back');
  const btnBet = document.getElementById('btn-bet');
  const btnSave = document.getElementById('btn-save');
  const btnHit = document.getElementById('btn-hit');
  const btnStand = document.getElementById('btn-stand');
  const btnDouble = document.getElementById('btn-double');
  const balanceEl = document.getElementById('balance');
  const potAmt = document.getElementById('pot-amt');
  const betInput = document.getElementById('bet-input');
  const messageEl = document.getElementById('message');
  const dealerCards = document.getElementById('dealer-cards');
  const playerCards = document.getElementById('player-cards');
  const dealerCountEl = document.getElementById('dealer-count');
  const playerCountEl = document.getElementById('player-count');
  const btnExport = document.getElementById('btn-export');
  const btnImport = document.getElementById('btn-import');
  const importFile = document.getElementById('import-file');
  const btnLeader = document.getElementById('btn-leader');
  const leaderModal = document.getElementById('leaderboard-modal');
  const leaderList = document.getElementById('leader-list');
  const leaderClose = document.getElementById('leader-close');
  const leaderClear = document.getElementById('leader-clear');
  const btnCheat = document.getElementById('btn-cheat');

  // audio (use small embedded assets where possible)
  let audioCtx = null;
  function ensureAudio(){ if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }

  // embedded short SFX as base64 wav (tiny files) - fallback to synth if decode fails
  const SFX_DATA = {
    deal: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',
    win:  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',
    lose: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',
    chip: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
  };
  const audioCache = {};

  async function playSfxAsset(key){
    try{
      ensureAudio();
      if(!audioCache[key]){
        const res = await fetch(SFX_DATA[key]);
        const buf = await res.arrayBuffer();
        audioCache[key] = await audioCtx.decodeAudioData(buf);
      }
      const src = audioCtx.createBufferSource(); src.buffer = audioCache[key]; const g = audioCtx.createGain(); g.gain.value = 0.08; src.connect(g); g.connect(audioCtx.destination); src.start();
    }catch(e){ synthSfx(key); }
  }

  function synthSfx(type){
    try{
      ensureAudio();
      const now = audioCtx.currentTime;
      if(type==='deal' || type==='chip'){
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.type='square'; o.frequency.setValueAtTime(300,now);
        g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(0.06, now+0.01); g.gain.exponentialRampToValueAtTime(0.0001, now+0.18);
        o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(now+0.18);
      } else if(type==='win'){
        const o1=audioCtx.createOscillator(); const o2=audioCtx.createOscillator(); const g=audioCtx.createGain(); o1.type='sine'; o2.type='sine'; o1.frequency.setValueAtTime(660,now); o2.frequency.setValueAtTime(880,now);
        g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(0.08, now+0.01); g.gain.exponentialRampToValueAtTime(0.0001, now+0.5);
        o1.connect(g); o2.connect(g); g.connect(audioCtx.destination); o1.start(); o2.start(); o1.stop(now+0.5); o2.stop(now+0.5);
      } else if(type==='lose'){
        const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(160,now);
        g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(0.06, now+0.02); g.gain.exponentialRampToValueAtTime(0.0001, now+0.4);
        o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(now+0.4);
      }
    }catch(e){/* no audio */}
  }

  function sfx(key){ playSfxAsset(key); }

  // state
  let balance = START_BALANCE;
  let deck = [];
  let dealer = [];
  let player = [];
  let currentBet = 0;
  let lastBalanceBeforeBet = START_BALANCE;
  let inRound = false;

  function saveGame(){
    const payload = {balance, timestamp:Date.now(), version:1};
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); showMessage('Game saved'); }
    catch(e){ showMessage('Save failed'); }
  }
  function loadGame(){
    try{
      // try current key, then legacy key and migrate
      let raw = localStorage.getItem(SAVE_KEY);
      if(!raw){ raw = localStorage.getItem(LEGACY_SAVE_KEY); if(raw){ try{ localStorage.setItem(SAVE_KEY, raw); localStorage.removeItem(LEGACY_SAVE_KEY); }catch(e){} } }
      if(!raw) return false;
      const obj = JSON.parse(raw);
      // preserve balance if present
      balance = typeof obj.balance==='number' ? obj.balance : START_BALANCE;
      updateBalance();
      showMessage('Save loaded');
      return true;
    }catch(e){return false}
  }
  function resetSave(){ localStorage.removeItem(SAVE_KEY); balance = START_BALANCE; updateBalance(); showMessage('Save reset'); }

  function exportSave(){
    // build a stable export object (don't rely on whatever raw string was stored)
    const exportObj = { balance: balance, timestamp: Date.now(), version: 1 };
    const raw = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([raw], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'playBlackJack-save.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function importSaveFile(file){
    const r = new FileReader();
    r.onload = () => {
      let txt = r.result;
      try{
        // strip potential BOM
        if(typeof txt === 'string' && txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
        let obj = JSON.parse(txt);
        // handle double-encoded JSON (a string containing JSON)
        if(typeof obj === 'string'){
          try{ obj = JSON.parse(obj); }catch(e){}
        }
        // try to recover common wrapper shapes
        if(obj && typeof obj === 'object'){
          if(typeof obj.save === 'object') obj = obj.save;
          if(typeof obj.data === 'object') obj = obj.data;
        }
        if(obj && typeof obj.balance === 'number'){
          localStorage.setItem(SAVE_KEY, JSON.stringify({balance: obj.balance, timestamp: obj.timestamp || Date.now(), version: obj.version || 1}));
          loadGame();
          showMessage('Import successful');
        } else {
          showMessage('Invalid save file');
        }
      }catch(e){ showMessage('Invalid JSON'); }
    };
    r.readAsText(file);
  }

  // leaderboard
  function getLeaderboard(){ try{ return JSON.parse(localStorage.getItem(LB_KEY)||'[]'); }catch(e){return []} }
  function setLeaderboard(lb){ localStorage.setItem(LB_KEY, JSON.stringify(lb)); }
  function maybeAddLeaderboardEntry(name,balanceVal){
    const lb = getLeaderboard(); lb.push({name:name||'Anon',balance:balanceVal||0,ts:Date.now()}); lb.sort((a,b)=>b.balance-a.balance); setLeaderboard(lb.slice(0,10));
  }

  function updateBalance(){
    if(balance<=0){ balance = RESCUE_BALANCE; showMessage('You ran out — rescue $'+RESCUE_BALANCE+' granted'); }
    balanceEl.textContent = '$' + numberWithCommas(balance);
    potAmt.textContent = currentBet;
  }

  function numberWithCommas(x){
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");
  }

  // compact number for leaderboard (thousands/millions)
  function compactNumber(x){
    if(x >= 1000000) return Math.floor(x / 1000000) + 'M+';
    if(x >= 1000) return Math.floor(x / 1000) + 'K+';
    return numberWithCommas(x);
  }

  function showMessage(txt){ messageEl.textContent = txt; }

  // deck utilities
  function makeDeck(){
    const suits = ['♠','♥','♦','♣'];
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const d=[];
    for(const s of suits){
      for(const r of ranks){
        const val = (r==='A')?11: (['J','Q','K'].includes(r)?10:parseInt(r));
        d.push({rank:r,suit:s,value:val});
      }
    }
    return d;
  }
  function shuffle(array){
    for(let i=array.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; }
  }

  // card DOM
  function createCardElement(card, faceUp=true){
    const el = document.createElement('div');
    el.className = 'card ' + (card.suit==='♥' || card.suit==='♦' ? 'red' : 'black');
    if(!faceUp) el.classList.add('face-down'); else el.classList.add('face-up');
    el.innerHTML = faceUp ? (`<div class="corner"><div class="rank">${card.rank}</div><div class="suit">${card.suit}</div></div><div class="suit" style="align-self:center;font-size:36px;opacity:0.9">${card.suit}</div><div class="corner" style="transform:rotate(180deg)"><div class="rank">${card.rank}</div><div class="suit">${card.suit}</div></div>`) : (`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;">★</div>`);
    return el;
  }

  function dealCardTo(targetArr, containerEl, faceUp=true, animateDelay=200){
    if(deck.length===0) deck = makeDeck(), shuffle(deck);
    const card = deck.pop();
    targetArr.push(card);
    updateTotals();
    updateCounts();
    const el = createCardElement(card, faceUp);
    el.style.opacity = 0; el.style.transform = 'translateY(-40px) scale(0.95)';
    containerEl.appendChild(el);
    // animate in
    setTimeout(()=>{ el.style.opacity=1; el.style.transform='translateY(0) scale(1)'; el.classList.add('flip'); }, animateDelay);
    sfx('deal');
    return card;
  }

  function visibleDealerTotal(){
    // sum visible dealer cards (exclude first card if it was dealt face-down)
    let total = 0; let aces = 0; if(dealer.length===0) return 0;
    for(let i=0;i<dealer.length;i++){
      // assume dealer[0] was face-down only at initial deal; when revealed we show full
      if(i===0 && dealer.length>1 && inRound) continue; // hide hole card during round
      total += dealer[i].value; if(dealer[i].rank==='A') aces++;
    }
    while(total>21 && aces>0){ total -= 10; aces--; }
    return total;
  }

  function updateTotals(){
    // player total
    const pTotal = handValue(player);
    const dTotalVisible = visibleDealerTotal();
    const playerTotalEl = document.getElementById('player-total');
    const dealerTotalEl = document.getElementById('dealer-total');
    if(playerTotalEl) playerTotalEl.textContent = pTotal;
    if(dealerTotalEl) dealerTotalEl.textContent = dTotalVisible;
  }

  function handValue(cards){
    let total=0; let aces=0;
    for(const c of cards){ total+=c.value; if(c.rank==='A') aces++; }
    while(total>21 && aces>0){ total-=10; aces--; }
    return total;
  }

  function startRound(){
    if(inRound) return;
    const bet = Math.max(1, Math.floor(Number(betInput.value)||0));
    if(bet>balance){ showMessage('Not enough balance'); return; }
    // prepare table, then set bet so pot UI shows correctly
    clearTable();
    lastBalanceBeforeBet = balance;
    currentBet = bet;
    balance -= bet; updateBalance();
    // animate chips moving to pot
    animateChips(bet);
    inRound = true;
    if(deck.length<15){ deck = makeDeck(); shuffle(deck); }
    dealCardTo(player, playerCards, true, 120);
    dealCardTo(dealer, dealerCards, false, 240);
    dealCardTo(player, playerCards, true, 360);
    dealCardTo(dealer, dealerCards, true, 480);
    showMessage('Dealt. Your move.');
    sfx('chip');
    setTimeout(()=>{ const pv = handValue(player); if(pv===21){ handleNatural(); } },700);
  }

  function clearTable(){
    dealer = [];
    player = [];
    dealerCards.innerHTML = '';
    playerCards.innerHTML = '';
    // keep currentBet untouched so outcome animation can still reference it
    potAmt.textContent = currentBet ? currentBet : '0';
    updateTotals();
    updateCounts();
  }
  

  function updateCounts(){
    if(dealerCountEl) dealerCountEl.textContent = dealer.length;
    if(playerCountEl) playerCountEl.textContent = player.length;
  }

  // chip animation: create flying chips from controls to pot
  function animateChips(amount){
    const controls = document.querySelector('.controls');
    const pot = document.getElementById('pot');
    if(!controls || !pot) return;
    const fromRect = controls.getBoundingClientRect();
    const toRect = pot.getBoundingClientRect();
    // create container
    const container = document.createElement('div'); container.style.position='fixed'; container.style.left=fromRect.left+'px'; container.style.top=fromRect.top+'px'; container.style.pointerEvents='none'; document.body.appendChild(container);
    const chips = [];
    for(let i=0;i<4;i++){
      const c = document.createElement('div'); c.className='chip'; c.style.left='10px'; c.style.transform='translateY(0)'; container.appendChild(c); chips.push(c);
    }
    // force layout
    void container.offsetWidth;
    // move
    chips.forEach((c,idx)=>{
      const delay = idx*80;
      setTimeout(()=>{
        c.classList.add('fly');
        const dx = toRect.left + toRect.width/2 - (fromRect.left + 22);
        const dy = toRect.top + toRect.height/2 - (fromRect.top + 6 + (idx* -6));
        c.style.transform = `translate(${dx}px, ${dy}px) scale(0.5)`;
        c.style.opacity='0.0';
      }, delay);
    });
    // cleanup
    setTimeout(()=>{ container.remove(); potAmt.textContent = currentBet; }, 1200);
  }

  function handleNatural(){
    revealDealerHole();
    const playerNatural = player.length===2 && handValue(player)===21;
    const dealerNatural = dealer.length===2 && handValue(dealer)===21;
    if(playerNatural && !dealerNatural){
      const payout = Math.floor(currentBet*2.5);
      balance += payout;
      sfx('win');
      showMessage('Blackjack! +$'+(payout-currentBet));
      maybeRecordLeaderboard();
    } else if(playerNatural && dealerNatural){
      balance += currentBet;
      showMessage('Push (both blackjack)');
    } else if(!playerNatural && dealerNatural){
      showMessage('Dealer Blackjack.');
    }
    inRound = false;
    const net = balance - lastBalanceBeforeBet;
    updateBalance();
    showOutcome(net);
    saveGame();
  }

  function revealDealerHole(){ if(dealerCards.children.length>0){ dealerCards.innerHTML=''; for(const c of dealer){ dealerCards.appendChild(createCardElement(c,true)); } updateTotals(); } }

  // show outcome overlay and animate pot/result
  function showOutcome(net){
    const el = document.getElementById('outcome-summary');
    if(!el) return;
    el.className = 'outcome';
    el.classList.remove('hidden');
    el.classList.remove('win','lose','push');
    let txt = '';
    if(net>0){ el.classList.add('win'); txt = `You win +$${numberWithCommas(net)}`; }
    else if(net<0){ el.classList.add('lose'); txt = `You lose -$${numberWithCommas(Math.abs(net))}`; }
    else { el.classList.add('push'); txt = `Push`; }
    el.textContent = txt;
    // trigger animation
    void el.offsetWidth; // force reflow
    el.classList.add('show');
    // clear overlay and reset bet after animation
    setTimeout(()=>{
      el.classList.remove('show');
      el.classList.add('hidden');
      currentBet = 0;
      potAmt.textContent = '0';
      updateBalance();
      saveGame();
    }, 1400);
  }
  
  
  

  function playerHit(){
    if(!inRound) return;
    dealCardTo(player, playerCards, true, 120);
    sfx('deal');
    setTimeout(()=>{
      const pv = handValue(player);
      if(pv>21){
        revealDealerHole();
        sfx('lose');
        showMessage('Bust! You lose.');
        inRound=false;
        const net = balance - lastBalanceBeforeBet; // typically negative (lost bet)
        showOutcome(net);
        saveGame();
      } else showMessage('You have '+pv+'.');
    },300);
  }

  function playerStand(){ if(!inRound) return; revealDealerHole(); dealerPlay(); }

  function playerDouble(){
    if(!inRound) return;
    if(balance<currentBet) { showMessage('Not enough to double'); return; }
    balance-=currentBet;
    currentBet*=2;
    updateBalance();
    dealCardTo(player, playerCards, true, 160);
    sfx('deal');
    setTimeout(()=>{
      const pv=handValue(player);
      if(pv>21){
        revealDealerHole();
        sfx('lose');
        showMessage('Bust!');
        inRound=false;
        const net = balance - lastBalanceBeforeBet;
        showOutcome(net);
        saveGame();
      } else dealerPlay();
    },400);
  }

  function dealerPlay(){ let delay=300; const step = ()=>{ const dval = handValue(dealer); if(dval<17){ dealCardTo(dealer, dealerCards, true, delay); sfx('deal'); delay+=300; setTimeout(step,300); } else finishDealer(); }; step(); }

  function finishDealer(){
    const pVal = handValue(player);
    const dVal = handValue(dealer);
    if(dVal>21 || pVal>dVal){
      balance += currentBet*2;
      sfx('win');
      showMessage('You win! +$'+(currentBet));
      maybeRecordLeaderboard();
    } else if(pVal===dVal){
      balance += currentBet;
      showMessage('Push.');
    } else{
      sfx('lose');
      showMessage('Dealer wins.');
    }
    inRound = false;
    const net = balance - lastBalanceBeforeBet;
    updateBalance();
    showOutcome(net);
    saveGame();
  }


  function cheatCode(){
    const code = prompt('Enter code:');
    if(code === '11012012'){
      balance *= 2;
      updateBalance();
      saveGame();
      showMessage('Balance doubled! 💰');
      sfx('win');
    } else {
      showMessage('Invalid code.');
    }
  }

  // UI bindings
  btnPlay.addEventListener('click', ()=>{ menu.classList.add('hidden'); gameScreen.classList.remove('hidden'); loadGameOnEnter(); });
  btnLoad.addEventListener('click', ()=>{ if(loadGame()) menu.classList.add('hidden'), gameScreen.classList.remove('hidden'); else showMessage('No save found'); });
  btnReset.addEventListener('click', ()=>{ if(confirm('Reset saved balance to $10,000?')) resetSave(); });
  btnBack.addEventListener('click', ()=>{ gameScreen.classList.add('hidden'); menu.classList.remove('hidden'); });
  btnBet.addEventListener('click', ()=>{ startRound(); });
  btnSave.addEventListener('click', ()=>{ saveGame(); });
  btnHit.addEventListener('click', ()=>{ tryResumeAudio(); playerHit(); });
  btnStand.addEventListener('click', ()=>{ tryResumeAudio(); playerStand(); });
  btnDouble.addEventListener('click', ()=>{ tryResumeAudio(); playerDouble(); });
  btnExport.addEventListener('click', ()=>{ exportSave(); });
  btnImport.addEventListener('click', ()=>{ importFile.click(); });
  importFile.addEventListener('change', (e)=>{ if(e.target.files && e.target.files[0]) importSaveFile(e.target.files[0]); importFile.value=''; });
  btnLeader.addEventListener('click', ()=>{ showLeaderboard(); });
  btnCheat.addEventListener('click', ()=>{ cheatCode(); });
  leaderClose && leaderClose.addEventListener('click', ()=>{ leaderModal.classList.add('hidden'); });
  leaderClear && leaderClear.addEventListener('click', ()=>{ if(confirm('Clear leaderboard?')){ setLeaderboard([]); renderLeaderboard(); } });

  // ripple effect for buttons (works for Play and others)
  function addRippleListeners(){
    document.addEventListener('click', function(e){
      const btn = e.target.closest && e.target.closest('.btn');
      if(!btn) return;
      const rect = btn.getBoundingClientRect();
      const d = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = d + 'px';
      ripple.style.left = (e.clientX - rect.left - d/2) + 'px';
      ripple.style.top = (e.clientY - rect.top - d/2) + 'px';
      btn.appendChild(ripple);
      // play click sound for buttons
      try{ sfx('chip'); }catch(e){}
      setTimeout(()=>{ ripple.remove(); }, 700);
    }, {passive:true});
  }

  function tryResumeAudio(){ if(audioCtx && audioCtx.state==='suspended') audioCtx.resume(); }

  function loadGameOnEnter(){ if(!loadGame()){ balance = START_BALANCE; updateBalance(); } }

  // initial setup
  function init(){ deck = makeDeck(); shuffle(deck); if(!loadGame()) balance = START_BALANCE; updateBalance(); showMessage('Ready. Place a bet.'); window.addEventListener('beforeunload', ()=>{ saveGame(); });
    // initialize counts
    updateCounts();
    // touch gestures
    attachTouchGestures();
    // ripple listeners
    addRippleListeners();
  }
  

  // leaderboard UI
  function renderLeaderboard(){ const lb = getLeaderboard(); leaderList.innerHTML=''; if(lb.length===0){ leaderList.innerHTML='<li>No entries yet</li>'; return; } for(const e of lb){ const li = document.createElement('li'); li.textContent = `${e.name} — $${numberWithCommas(e.balance)}`; leaderList.appendChild(li); } }
  function showLeaderboard(){ renderLeaderboard(); leaderModal.classList.remove('hidden'); }

  function maybeRecordLeaderboard(){ const lb = getLeaderboard(); const lowest = lb.length<10 ? 0 : lb[lb.length-1].balance; if(lb.length<10 || balance>lowest){ const name = prompt('You made the leaderboard! Enter a name:', 'Player'); maybeAddLeaderboardEntry(name,balance); } }

  // touch gestures for mobile: swipe down = hit, swipe up = stand, double-tap = double
  function attachTouchGestures(){
    let lastTap = 0; let startY = null; let moved = false;
    document.addEventListener('touchstart', (e)=>{ startY = e.touches[0].clientY; moved=false; const now = Date.now(); if(now - lastTap < 300){ // double-tap
      tryResumeAudio(); playerDouble(); }
      lastTap = now;
    });
    document.addEventListener('touchmove', (e)=>{ if(startY===null) return; const dy = e.touches[0].clientY - startY; if(Math.abs(dy)>10) moved=true; });
    document.addEventListener('touchend', (e)=>{ if(startY===null) return; if(!moved){ startY=null; return; } const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : startY; const dy = endY - startY; startY=null; if(dy>60){ // swipe down
      tryResumeAudio(); playerHit();
    } else if(dy<-60){ tryResumeAudio(); playerStand(); }
  }); }

  // autostart
  window.addEventListener('DOMContentLoaded', init);

  // expose helpers
  window.playBlackJack = {saveGame, loadGame, resetSave, startRound, exportSave, importSaveFile};

  document.addEventListener('click', ()=>{ try{ if(!audioCtx) ensureAudio(); if(audioCtx.state==='suspended') audioCtx.resume(); }catch(e){} }, {once:false});
})();
