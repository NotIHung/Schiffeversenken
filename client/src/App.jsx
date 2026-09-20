import React, { useEffect, useMemo, useRef, useState } from 'react'

const SHIPS = [
  { name: 'Schlachtschiff', size: 4 },
  { name: 'Kreuzer', size: 3 },
  { name: 'U-Boot', size: 3 },
  { name: 'Zerstörer', size: 2 },
  { name: 'Patrouillenboot', size: 2 },
]

const SHIP_COLORS = ['#50b9e7','#ff8a65','#9ccc65','#ffd54f','#b39ddb', '#4db6ac','#f06292','#ba68c8','#81c784','#ffb74d']

const emptyBoard = () => Array.from({ length: 10 }, () => Array(10).fill(null))
const generated = Math.random().toString(36).slice(2, 7).toUpperCase()

function App() {
  const [screen, setScreen] = useState('home')
  const [room, setRoom] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('Bereit.')
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const ws = useRef(null)
  const [modal, setModal] = useState(null)

  const connect = () => {
    const url = import.meta.env.VITE_WS_URL ||
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3001`
    const socket = new WebSocket(url)
    ws.current = socket
    socket.onopen = () => {
      setConnected(true)
      socket.send(JSON.stringify({ type: 'join', room: roomInput.trim().toUpperCase(), name: name.trim() || 'Spieler' }))
    }
    socket.onmessage = e => {
      const data = JSON.parse(e.data)
      if (data.type === 'error') {
        setMessage(data.message)
        return
      }
      if (data.type === 'state') {
        setState(data.state)
        setRoom(data.room)
        setScreen('game')
        setMessage(data.message || '')
      }
    }
    socket.onclose = () => {
      setConnected(false)
      setMessage('Verbindung zum Server verloren.')
    }
    socket.onerror = () => setMessage('Verbindung konnte nicht hergestellt werden.')
  }

  const createRoom = () => {
    setRoomInput(generated)
    setScreen('join')
  }

  const joinRoom = () => {
    if (!roomInput.trim()) return setMessage('Bitte einen Raumcode eingeben.')
    connect()
  }

  const send = payload => ws.current?.readyState === WebSocket.OPEN &&
    ws.current.send(JSON.stringify(payload))

  const fire = (r, c) => {
    if (!state || state.turn !== state.me || state.phase !== 'playing') return
    send({ type: 'fire', r, c })
  }

  const ready = () => send({ type: 'ready' })

  const restart = () => send({ type: 'restart' })

  const leave = () => {
    ws.current?.close()
    setState(null)
    setScreen('home')
    setRoom('')
  }

  const board = state?.myBoard || emptyBoard()
  const enemy = state?.enemyBoard || emptyBoard()

  const shipColorMap = useMemo(()=>{
    const map = {}
    const ships = Array.isArray(state?.myShips) ? state.myShips : []
    ships.forEach((s,i)=>{
      const key = s?.id || s?.name || `ship-${i}`
      map[key] = SHIP_COLORS[i % SHIP_COLORS.length]
    })
    return map
  },[state?.myShips])

  const sunkSet = useMemo(() => {
    const set = new Set()
    if (Array.isArray(state?.myShips)) state.myShips.forEach(s => s?.sunk && s.id && set.add(s.id))
    return set
  }, [state?.myShips])

  const status = useMemo(() => {
    if (!state) return ''
    if (state.phase === 'waiting') return 'Warte auf den zweiten Spieler …'
    if (state.phase === 'placement') return state.ready ? 'Du bist bereit – warte auf den Gegner.' : 'Bestätige deine Flotte.'
    if (state.phase === 'playing') return state.turn === state.me ? 'Du bist am Zug!' : 'Gegner ist am Zug …'
    return state.winner === state.me ? '🎉 Du hast gewonnen!' : '💥 Du hast verloren.'
  }, [state])

  const myPoints = state?.myPoints ?? 0
  const enemyPoints = state?.enemyPoints ?? 0

  const canUse = (cost) => state && state.phase === 'playing' && state.turn === state.me && (myPoints >= cost)

  // Modal helpers: setModal({type, props})
  const openConfirm = (message, onConfirm) => setModal({ type: 'confirm', message, onConfirm })
  const openCoords = (onConfirm, defaults = { r: 0, c: 0 }) => setModal({ type: 'coords', onConfirm, defaults })
  const openIndex = (dir, onConfirm, def = 0) => setModal({ type: 'index', dir, onConfirm, def })

  const useRandom5 = () => openConfirm('5 zufällige Schüsse für 5 Punkte ausführen?', () => send({ type: 'ability', ability: 'random5' }))
  const useBlock2 = () => openCoords(({ r, c }) => send({ type: 'ability', ability: 'block2', r, c }))
  const useRow = () => openIndex('row', (idx) => send({ type: 'ability', ability: 'rowcol', dir: 'row', idx }))
  const useCol = () => openIndex('col', (idx) => send({ type: 'ability', ability: 'rowcol', dir: 'col', idx }))
  const useNuke = () => openConfirm('Nuke für 50 Punkte einsetzen? Das trifft das ganze Feld.', () => send({ type: 'ability', ability: 'nuke' }))

  if (screen === 'home') return (
    <main className="app home">
      <div className="hero">
        <div className="ship-icon">⚓</div>
        <h1>Schiffe<br /><span>Versenken</span></h1>
        <p>Das klassische Duell – direkt im Browser.</p>
        <button className="secondary" onClick={() => setScreen('join')}>Spielen</button>
      </div>
    </main>
  )

  if (screen === 'join') return (
    <main className="app centered">
      <section className="card join-card">
        <button className="back" onClick={() => setScreen('home')}>← Zurück</button>
        <h2>Spiel beitreten</h2>
        <p>Teile den Raumcode mit deinem Gegner.</p>
        <label>Dein Name</label>
        <input value={name} maxLength={18} onChange={e => setName(e.target.value)} placeholder="Spieler" />
        <label>Raumcode</label>
        <input className="code-input" value={roomInput} maxLength={5}
          onChange={e => setRoomInput(e.target.value.toUpperCase())} placeholder="ABCDE" />
        <button className="primary" onClick={joinRoom}>Beitreten</button>
        <div className="hint">{message}</div>
      </section>
    </main>
  )

  return (
    <main className="app game">
      <header className="topbar">
        <div><span className="logo">⚓</span> SCHIFFE VERSENKEN</div>
        <div className="room">RAUM <b>{room}</b> · {connected ? '● ONLINE' : '○ OFFLINE'}</div>
        <button className="leave" onClick={leave}>Verlassen</button>
      </header>

      <section className="game-head">
        <div>
          <h2>{status}</h2>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button className="secondary small" onClick={()=>send({type:'randomize'})}
            disabled={!state || state.phase !== 'placement' || state.ready}>
            Flotte randomisieren
          </button>
          <button className="primary small" onClick={ready}
            disabled={!state || state.phase !== 'placement' || state.ready}>
            {state?.ready ? 'Bereit ✓' : 'Flotte bestätigen'}
          </button>
        </div>
      </section>
      <div className="boards-wrap">
        <div className="boards">
          <Board title="Deine Flotte" board={board} own myShips={state?.myShips} shipColorMap={shipColorMap} sunkSet={sunkSet} />
          <Board title="Gegnerisches Meer" board={enemy} onFire={fire}
            disabled={state?.turn !== state?.me || state?.phase !== 'playing'} />
        </div>

        <section className="scorebar">
          <div className="points left">Punkte: {myPoints}</div>
          <div className="points right">Gegner: {enemyPoints}</div>
        </section>
      </div>

      <section className="abilities">
        <div className="ability-row">
          <button className="secondary" onClick={useRandom5} disabled={!canUse(5)}>5 Zufalls-Schüsse (5)</button>
          <button className="secondary" onClick={useBlock2} disabled={!canUse(5)}>2x2 Schuss (5)</button>
          <button className="secondary" onClick={useRow} disabled={!canUse(10)}>Reihe (10)</button>
          <button className="secondary" onClick={useCol} disabled={!canUse(10)}>Spalte (10)</button>
          <button className="secondary" onClick={useNuke} disabled={!canUse(50)}>Nuke (50)</button>
        </div>
        <div className="hint">{message}</div>
      </section>

      {state?.phase === 'finished' && (
        <div className="overlay">
          <div className="result card">
            <div className="result-icon">{state.winner === state.me ? '🏆' : '💥'}</div>
            <h2>{state.winner === state.me ? 'Sieg!' : 'Niederlage'}</h2>
            <p>{state.winner === state.me ? 'Du hast die gegnerische Flotte versenkt.' : 'Deine Flotte wurde versenkt.'}</p>
            <button className="primary" onClick={restart}>Neue Runde</button>
            <button className="secondary" onClick={leave}>Zurück zum Start</button>
          </div>
        </div>
      )}

      {/* Modal overlay for inputs and confirmations */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal-card card">
            {modal.type === 'confirm' && (
              <>
                <p style={{marginBottom:18}}>{modal.message}</p>
                <div style={{display:'flex',gap:10,justifyContent:'center'}}>
                  <button className="primary" onClick={() => { modal.onConfirm(); setModal(null) }}>Bestätigen</button>
                  <button className="secondary" onClick={() => setModal(null)}>Abbrechen</button>
                </div>
              </>
            )}
            {modal.type === 'coords' && (
              <CoordsForm defaults={modal.defaults} onCancel={() => setModal(null)} onConfirm={(r,c)=>{ modal.onConfirm({r,c}); setModal(null) }} />
            )}
            {modal.type === 'index' && (
              <IndexForm dir={modal.dir} def={modal.def} onCancel={() => setModal(null)} onConfirm={(idx)=>{ modal.onConfirm(idx); setModal(null) }} />
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function Board({ title, board, own, onFire, disabled, shipColorMap, sunkSet }) {
  return (
    <section className="board-wrap">
      <div className="board-title">{title}</div>
      <div className="board">
        <div className="corner"></div>
        {Array.from({ length: 10 }, (_, i) => <div className="axis" key={'x'+i}>{i+1}</div>)}
        {board.map((row, r) => <React.Fragment key={r}>
          <div className="axis">{r+1}</div>
          {row.map((cell, c) => {
            const shipId = cell?.shipId || (cell?.ship ? 'unknown' : null)
            const cellSunk = cell?.sunk === true
            const isSunk = cellSunk || (shipId && sunkSet?.has?.(shipId))
            const type = isSunk ? 'sunk' : (cell?.hit ? 'hit' : cell?.miss ? 'miss' : shipId ? 'ship' : '')
            const style = (own && shipId && !isSunk) ? { background: shipColorMap?.[shipId] || undefined } : undefined
            return <button key={c} className={`cell ${type} ${disabled ? 'disabled' : ''}`}
              style={style}
              disabled={!onFire || disabled || cell?.hit || cell?.miss}
              onClick={() => onFire?.(r, c)}>
              {isSunk ? '✦' : (cell?.hit ? '' : cell?.miss ? '•' : '')}
            </button>
          })}
        </React.Fragment>)}
      </div>
    </section>
  )
}

export default App

function CoordsForm({ defaults, onCancel, onConfirm }){
  const [r, setR] = useState(defaults.r || 0)
  const [c, setC] = useState(defaults.c || 0)
  return (
    <div>
      <label style={{textTransform:'uppercase',fontSize:12,letterSpacing:'.12em'}}>Oben-links Koordinate</label>
      <div style={{display:'flex',gap:8,marginTop:8}}>
        <input type="number" min={0} max={9} value={r} onChange={e=>setR(Number(e.target.value))} />
        <input type="number" min={0} max={9} value={c} onChange={e=>setC(Number(e.target.value))} />
      </div>
      <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:14}}>
        <button className="primary" onClick={()=> onConfirm(r,c)}>Bestätigen</button>
        <button className="secondary" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  )
}

function IndexForm({ dir, def, onCancel, onConfirm }){
  const [idx, setIdx] = useState(def || 0)
  return (
    <div>
      <label style={{textTransform:'uppercase',fontSize:12,letterSpacing:'.12em'}}>{dir === 'row' ? 'Zeile' : 'Spalte'} (1-10)</label>
      <input type="number" min={1} max={10} value={idx} onChange={e=>setIdx(Number(e.target.value))} style={{marginTop:8}} />
      <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:14}}>
        <button className="primary" onClick={()=> onConfirm(idx-1)}>Bestätigen</button>
        <button className="secondary" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  )
}
