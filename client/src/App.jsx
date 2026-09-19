import React, { useEffect, useMemo, useRef, useState } from 'react'

const SHIPS = [
  { name: 'Schlachtschiff', size: 4 },
  { name: 'Kreuzer', size: 3 },
  { name: 'U-Boot', size: 3 },
  { name: 'Zerstörer', size: 2 },
  { name: 'Patrouillenboot', size: 2 },
]

const SHIP_COLORS = ['#50b9e7','#ff8a65','#9ccc65','#ffd54f','#b39ddb']

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
    (state?.myShips||[]).forEach((s,i)=>{
      map[s.id] = SHIP_COLORS[i % SHIP_COLORS.length]
    })
    return map
  },[state?.myShips])

  const status = useMemo(() => {
    if (!state) return ''
    if (state.phase === 'waiting') return 'Warte auf den zweiten Spieler …'
    if (state.phase === 'placement') return state.ready ? 'Du bist bereit – warte auf den Gegner.' : 'Bestätige deine Flotte.'
    if (state.phase === 'playing') return state.turn === state.me ? 'Du bist am Zug!' : 'Gegner ist am Zug …'
    return state.winner === state.me ? '🎉 Du hast gewonnen!' : '💥 Du hast verloren.'
  }, [state])

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
          <div className="eyebrow">MULTIPLAYER</div>
          <h2>{status}</h2>
          <p>{message}</p>
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

      <div className="boards">
        <Board title="Deine Flotte" board={board} own myShips={state?.myShips} shipColorMap={shipColorMap} />
        <Board title="Gegnerisches Meer" board={enemy} onFire={fire}
          disabled={state?.turn !== state?.me || state?.phase !== 'playing'} />
      </div>

      <section className="legend">
        {(state?.myShips || SHIPS).map((s,idx)=>(
          <span key={s.id||s.name}><i className="ship-swatch" style={{background: shipColorMap[s.id] || SHIP_COLORS[idx % SHIP_COLORS.length]}}></i> {s.name}</span>
        ))}
        <span><i className="miss"></i> Fehlschuss</span>
        <span><i className="hit"></i> Treffer</span>
        <span>Flotte: {state?.myShips?.filter(s => s.sunk).length || 0}/{SHIPS.length} versenkt</span>
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
    </main>
  )
}

function Board({ title, board, own, onFire, disabled, shipColorMap }) {
  return (
    <section className="board-wrap">
      <div className="board-title">{title}</div>
      <div className="board">
        <div className="corner"></div>
        {Array.from({ length: 10 }, (_, i) => <div className="axis" key={'x'+i}>{String.fromCharCode(65+i)}</div>)}
        {board.map((row, r) => <React.Fragment key={r}>
          <div className="axis">{r+1}</div>
          {row.map((cell, c) => {
            const shipId = cell?.shipId || (cell?.ship ? 'unknown' : null)
            const type = cell?.hit ? 'hit' : cell?.miss ? 'miss' : shipId ? 'ship' : ''
            const style = own && shipId ? { background: shipColorMap?.[shipId] } : undefined
            return <button key={c} className={`cell ${type} ${disabled ? 'disabled' : ''}`}
              style={style}
              disabled={!onFire || disabled || cell?.hit || cell?.miss}
              onClick={() => onFire?.(r, c)}>
              {cell?.hit ? '✦' : cell?.miss ? '•' : ''}
            </button>
          })}
        </React.Fragment>)}
      </div>
    </section>
  )
}

export default App
