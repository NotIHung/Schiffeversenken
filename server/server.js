import http from 'node:http'
import { WebSocketServer } from 'ws'
import crypto from 'node:crypto'

const PORT = process.env.PORT || 3001
const rooms = new Map()
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)

const SHIPS = [
  { name:'Schlachtschiff', size:4 },
  { name:'Kreuzer', size:3 },
  { name:'U-Boot', size:3 },
  { name:'Zerstörer', size:2 },
  { name:'Patrouillenboot', size:2 },
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
  return {ws,name:name || 'Spieler', ...fleet, ready:false}
}

function publicState(room, player) {
  const enemy = room.players.find(p=>p!==player)
  const myBoard = player.board.map(row=>row.map(cell=>{
    if (!cell) return null
    return {
      ship: !!cell.shipId,
      hit: cell.hit === true,
      miss: cell.miss === true
    }
  }))
  const enemyBoard = enemy ? enemy.board.map(row=>row.map(cell=>{
    if (!cell) return null
    return { hit:cell.hit===true, miss:cell.miss===true }
  })) : empty()
  return {
    me: room.players.indexOf(player),
    turn: room.turn,
    phase: room.phase,
    winner: room.winner,
    ready: player.ready,
    myBoard,
    enemyBoard,
    myShips: player.ships.map(s=>({name:s.name,size:s.size,sunk:s.hits.length===s.size}))
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

    if(msg.type==='fire'){
      if(room.phase!=='playing'||room.turn!==room.players.indexOf(player)) return
      const enemy=room.players.find(p=>p!==player)
      const r=Number(msg.r),c=Number(msg.c)
      if(!Number.isInteger(r)||!Number.isInteger(c)||r<0||r>9||c<0||c>9) return
      const cell=enemy.board[r][c]
      if(cell?.hit || cell?.miss) return
      if(cell?.shipId){
        cell.hit=true
        const ship=enemy.ships.find(s=>s.id===cell.shipId)
        ship.hits.push(`${r},${c}`)
        const sunk=ship.hits.length===ship.size
        const allSunk=enemy.ships.every(s=>s.hits.length===s.size)
        if(allSunk){room.phase='finished';room.winner=room.players.indexOf(player);broadcast(room,'Alle gegnerischen Schiffe sind versenkt!');return}
        broadcast(room,sunk?`${player.name} hat ein ${ship.name} versenkt!`:`Treffer!`)
      }else{
        if(!cell) enemy.board[r][c]={miss:true}
        else cell.miss=true
        room.turn=room.players.indexOf(enemy)
        broadcast(room,'Fehlschuss.')
      }
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
