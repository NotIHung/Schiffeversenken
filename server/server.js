import http from 'node:http'
import { WebSocketServer } from 'ws'
import crypto from 'node:crypto'

const PORT = process.env.PORT || 3001
const rooms = new Map()
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)

const SHIPS = [
  
  { name:'Flugzeugträger', size:5 },
  { name:'Schlachtschiff', size:4 },
  { name:'Kreuzer', size:3 },
  { name:'U-Boot', size:3 },
  { name:'Zerstörer', size:2 },
  { name:'Patrouillenboot', size:2 },
  { name:'Jetski1', size:1 },
  { name:'Jetski2', size:1 },
]

const empty = () => Array.from({length:10},()=>Array(10).fill(null))

function randomFleet() {
  const board = empty(), ships = []
  for (const spec of SHIPS) {
    let placed = false
    while (!placed) {
      const horizontal = Math.random() < .5
      const r = Math.floor(Math.random()*10), c = Math.floor(Math.random()*10)
      const cells = []
      for (let i=0;i<spec.size;i++) {
        const rr = r + (horizontal ? 0 : i), cc = c + (horizontal ? i : 0)
        if (rr>=10 || cc>=10 || board[rr][cc]) { cells.length=0; break }
        cells.push([rr,cc])
      }
      if (cells.length === spec.size) {
        const ship = { id:crypto.randomUUID(), name:spec.name, size:spec.size, cells, hits:[] }
        ships.push(ship); cells.forEach(([rr,cc])=>board[rr][cc]={shipId:ship.id})
        placed=true
      }
    }
  }
  return {board, ships}
}

function makePlayer(ws,name) {
  const fleet = randomFleet()
  return {ws,name:name || 'Spieler', ...fleet, ready:false, points:0}
}

function publicState(room, player) {
  const enemy = room.players.find(p=>p!==player)
  const myBoard = player.board.map(row=>row.map(cell=>{
    if (!cell) return null
    return {
      ship: !!cell.shipId,
      shipId: cell.shipId || null,
      hit: cell.hit === true,
      miss: cell.miss === true
    }
  }))
  const enemyBoard = enemy ? enemy.board.map(row=>row.map(cell=>{
    if (!cell) return null
    const ship = cell.shipId ? enemy.ships.find(s=>s.id===cell.shipId) : null
    const sunk = !!(ship && ship.hits.length === ship.size)
    // Reveal ship presence/id to the shooter when the ship is sunk or when the round has finished
    const reveal = sunk || room.phase === 'finished'
    const base = { hit:cell.hit===true, miss:cell.miss===true, sunk }
    if (reveal) return { ...base, ship: !!cell.shipId, shipId: cell.shipId || null }
    return base
  })) : empty()
  return {
    me: room.players.indexOf(player),
    turn: room.turn,
    phase: room.phase,
    winner: room.winner,
    ready: player.ready,
    myBoard,
    enemyBoard,
    myShips: player.ships.map(s=>({id:s.id,name:s.name,size:s.size,sunk:s.hits.length===s.size})),
    myPoints: player.points || 0,
    enemyPoints: (enemy && (enemy.points || 0)) || 0
  }
}

function broadcast(room,message='') {
  room.players.forEach(p => {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({
      type:'state', room:room.code, message, state:publicState(room,p)
    }))
  })
}

function startIfReady(room) {
  if (room.players.length===2 && room.players.every(p=>p.ready)) {
    room.phase='playing'
    room.turn=0
    broadcast(room,'Das Spiel beginnt!')
  }
}

function resetRoom(room) {
  room.players.forEach(p=>{
    const fleet=randomFleet()
    p.board=fleet.board;p.ships=fleet.ships;p.ready=false
  })
  room.players.forEach(p=>p.points=0)
  room.phase='placement';room.turn=0;room.winner=null
  broadcast(room,'Neue Runde gestartet.')
}

const server=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'})
  res.end(JSON.stringify({ok:true,rooms:rooms.size}))
})
const wss=new WebSocketServer({server})

wss.on('connection',(ws,req)=>{
  const origin=req.headers.origin
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
    ws.close(1008,'Origin not allowed'); return
  }
  let player=null, room=null

  ws.on('message',raw=>{
    let msg
    try{msg=JSON.parse(raw.toString())}catch{return}
    if(msg.type==='join'){
      const code=String(msg.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)
      if(!code) return ws.send(JSON.stringify({type:'error',message:'Ungültiger Raumcode.'}))
      room=rooms.get(code)
      if(!room){room={code,players:[],phase:'waiting',turn:0,winner:null};rooms.set(code,room)}
      if(room.players.length>=2) return ws.send(JSON.stringify({type:'error',message:'Dieser Raum ist bereits voll.'}))
      player=makePlayer(ws,String(msg.name||'Spieler').slice(0,18))
      room.players.push(player)
      if(room.players.length===2) room.phase='placement'
      broadcast(room,room.players.length===1?'Warte auf einen Gegner …':'Beide Spieler sind da. Platziere deine Flotte.')
      return
    }

    if(!room||!player) return
    if(msg.type==='ready'){
      if(room.phase!=='placement') return
      player.ready=true
      startIfReady(room)
      if(room.phase==='placement') broadcast(room,`${player.name} ist bereit.`)
    }

    if(msg.type==='randomize'){
      if(room.phase!=='placement') return
      const fleet = randomFleet()
      player.board = fleet.board
      player.ships = fleet.ships
      player.ready = false
      broadcast(room, ``)
      return
    }

    if(msg.type==='fire'){
      if(room.phase!=='playing'||room.turn!==room.players.indexOf(player)) return
      const enemy=room.players.find(p=>p!==player)
      const r=Number(msg.r),c=Number(msg.c)
      if(!Number.isInteger(r)||!Number.isInteger(c)||r<0||r>9||c<0||c>9) return
      // apply single shot
      const cell=enemy.board[r][c]
      if(cell?.hit || cell?.miss) return
      if(cell?.shipId){
        cell.hit=true
        const ship=enemy.ships.find(s=>s.id===cell.shipId)
        ship.hits.push(`${r},${c}`)
        // award 1 point to shooter for hit
        enemy.points = (enemy.points||0) + 1
        const sunk=ship.hits.length===ship.size
        const allSunk=enemy.ships.every(s=>s.hits.length===s.size)
        if(allSunk){
          room.phase='finished';room.winner=room.players.indexOf(player)
          // each player gets 1 point at round end
          room.players.forEach(p=>p.points = (p.points||0)+1)
          broadcast(room,'Alle gegnerischen Schiffe sind versenkt!')
          return
        }
        broadcast(room,sunk?`${player.name} hat ein ${ship.name} versenkt!`:`Treffer!`)
      }else{
        if(!cell) enemy.board[r][c]={miss:true}
        else cell.miss=true
        player.points = (player.points||0) + 1
        room.turn=room.players.indexOf(enemy)
        broadcast(room,'Fehlschuss.')
      }
    }

    // Abilities: multi-shot effects triggered by a player
    if(msg.type==='ability'){
      if(room.phase!=='playing'||room.turn!==room.players.indexOf(player)) return
      const enemy=room.players.find(p=>p!==player)
      const ability = String(msg.ability||'')
      const costMap = { random5:5, block2:5, rowcol:10, nuke:50 }
      const cost = costMap[ability]
      if(!cost) return
      if((player.points||0) < cost) return ws.send(JSON.stringify({type:'error',message:'Nicht genug Punkte.'}))
      player.points = (player.points||0) - cost

      // helper to apply a shot to enemy board
      const applyShot = (rr,cc)=>{
        if(rr<0||rr>9||cc<0||cc>9) return null
        const cell = enemy.board[rr][cc]
        if(!cell) { enemy.board[rr][cc] = { miss:true }; return { r:rr,c:cc, hit:false } }
        if(cell.hit || cell.miss) return null
        if(cell.shipId){
          cell.hit = true
          const ship = enemy.ships.find(s=>s.id===cell.shipId)
          ship.hits.push(`${rr},${cc}`)
          // award 1 point per hit
          enemy.points = (enemy.points||0) + 1
          const sunk = ship.hits.length === ship.size
          const allSunk = enemy.ships.every(s=>s.hits.length===s.size)
          return { r:rr,c:cc, hit:true, sunk, shipName:ship.name, allSunk }
        } else {
          cell.miss = true
          return { r:rr,c:cc, hit:false }
        }
      }

      let results = []
      if(ability==='random5'){
        const candidates = []
        for(let rr=0;rr<10;rr++) for(let cc=0;cc<10;cc++){
          const cell = enemy.board[rr][cc]
          if(!cell || (!cell.hit && !cell.miss)) candidates.push([rr,cc])
        }
        for(let i=0;i<5 && candidates.length;i++){
          const idx = Math.floor(Math.random()*candidates.length)
          const [rr,cc] = candidates.splice(idx,1)[0]
          const res = applyShot(rr,cc)
          if(res) results.push(res)
        }
      }
      if(ability==='block2'){
        const r = Number(msg.r||0), c = Number(msg.c||0)
        for(let dr=0;dr<2;dr++) for(let dc=0;dc<2;dc++){
          const rr=r+dr, cc=c+dc
          const res = applyShot(rr,cc)
          if(res) results.push(res)
        }
      }
      if(ability==='rowcol'){
        const dir = String(msg.dir||'row')
        const idx = Number(msg.idx)
        if(dir==='row'){
          for(let cc=0;cc<10;cc++){ const res = applyShot(idx,cc); if(res) results.push(res) }
        }else{
          for(let rr=0;rr<10;rr++){ const res = applyShot(rr,idx); if(res) results.push(res) }
        }
      }
      if(ability==='nuke'){
        for(let rr=0;rr<10;rr++) for(let cc=0;cc<10;cc++){ const res = applyShot(rr,cc); if(res) results.push(res) }
      }

      // After ability, pass turn to enemy
      room.turn = room.players.indexOf(enemy)

      // Check for allSunk
      const enemyAllSunk = enemy.ships.every(s=>s.hits.length===s.size)
      if(enemyAllSunk){ room.phase='finished'; room.winner = room.players.indexOf(player); room.players.forEach(p=>p.points = (p.points||0)+1); broadcast(room,'Alle gegnerischen Schiffe sind versenkt!'); return }

      // Send aggregated message
      const hits = results.filter(r=>r.hit)
      if(hits.length) broadcast(room, `${player.name} hat ${hits.length} Treffer gelandet.`)
      else broadcast(room, `${player.name} hat mit Fähigkeit geschossen.`)
      return
    }

    if(msg.type==='restart' && room.phase==='finished') resetRoom(room)
  })

  ws.on('close',()=>{
    if(!room||!player) return
    room.players=room.players.filter(p=>p!==player)
    if(room.players.length===0) rooms.delete(room.code)
    else {room.phase='waiting';room.turn=0;room.winner=null;room.players[0].ready=false;broadcast(room,'Der Gegner hat den Raum verlassen.')}
  })
})

server.listen(PORT,()=>console.log(`WebSocket server listening on ${PORT}`))
