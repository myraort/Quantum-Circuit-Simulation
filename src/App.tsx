import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import './App.css'

type Complex = { re: number; im: number }
type GateType = 'H' | 'X' | 'Z' | 'CNOT'
type Tool = GateType | 'SELECT' | 'ERASE'
type Gate = { type: GateType; target: number; control?: number; name?: string }
type Box = { x1: number; y1: number; x2: number; y2: number }

const MIN_QUBITS = 2
const MAX_QUBITS = 6
const MIN_COLUMNS = 4
const MAX_COLUMNS = 24
const initialCircuit: (Gate | null)[] = [
  { type: 'H', target: 0 },
  { type: 'CNOT', control: 0, target: 1 },
  { type: 'X', target: 2 },
  { type: 'H', target: 1 },
  { type: 'Z', target: 0 },
  { type: 'CNOT', control: 1, target: 2 },
  { type: 'H', target: 2 },
  { type: 'X', target: 0 },
  { type: 'Z', target: 1 },
  { type: 'CNOT', control: 2, target: 1 },
]

const gateHelp: Record<GateType, string> = {
  H: 'Hadamard (H) — puts a qubit into an equal superposition of 0 and 1.',
  X: 'Pauli-X (X) — flips a qubit: |0⟩ becomes |1⟩ and |1⟩ becomes |0⟩.',
  Z: 'Pauli-Z (Z) — flips the phase of the |1⟩ component without directly changing probability.',
  CNOT: 'Controlled-X (●—⊕) — flips the target when the control qubit is 1; it can create entanglement.',
}

const gateDetails: Record<GateType, { name: string; description: string; factor?: string; matrix: string[][]; example: string }> = {
  H: {
    name: 'Hadamard Gate',
    description: 'Creates an equal superposition of |0⟩ and |1⟩.',
    factor: '1/√2',
    matrix: [['1', '1'], ['1', '−1']],
    example: '|0⟩ → (|0⟩ + |1⟩) / √2',
  },
  X: {
    name: 'Pauli-X Gate',
    description: 'Flips a qubit, like a classical NOT operation.',
    matrix: [['0', '1'], ['1', '0']],
    example: '|0⟩ → |1⟩   and   |1⟩ → |0⟩',
  },
  Z: {
    name: 'Pauli-Z Gate',
    description: 'Changes the phase of |1⟩ while leaving |0⟩ unchanged.',
    matrix: [['1', '0'], ['0', '−1']],
    example: '|+⟩ → |−⟩',
  },
  CNOT: {
    name: 'Controlled-X Gate',
    description: 'Flips the target when the control is 1. It can entangle two qubits.',
    matrix: [['1', '0', '0', '0'], ['0', '1', '0', '0'], ['0', '0', '0', '1'], ['0', '0', '1', '0']],
    example: '|10⟩ → |11⟩   and   |11⟩ → |10⟩',
  },
}

const glossary = [
  ['Qubit', 'The quantum version of a bit. It can be 0, 1, or a superposition of both.'],
  ['Gate', 'An operation that changes one or more qubits.'],
  ['Superposition', 'A combination of possible states before measurement.'],
  ['Entanglement', 'A connection between qubits whose measurement results become correlated.'],
  ['Amplitude', 'A number that describes the weight and phase of a possible state.'],
  ['Phase', 'The angle or sign of an amplitude. Phase controls how states interfere.'],
  ['Measurement', 'The act of sampling a classical result from the quantum state.'],
]

const guideSteps = [
  ['Begin with |00⟩', 'Every qubit starts at 0. Press Clear if the circuit contains gates.'],
  ['Create superposition', 'Drag an H gate onto q0 in Column 1. q0 will become 50% zero and 50% one.'],
  ['Create entanglement', 'Drag Controlled X onto q0 in Column 2. It connects q0 to q1.'],
  ['Explore each step', 'Use Previous and Next. Compare the state before and after each gate.'],
  ['Measure the circuit', 'Press Measure once, then Run 100 to see how probabilities become experimental counts.'],
]

function zeroState(qubits: number): Complex[] {
  return Array.from({ length: 2 ** qubits }, (_, index) => ({ re: index === 0 ? 1 : 0, im: 0 }))
}

function applyGate(state: Complex[], gate: Gate, qubits: number): Complex[] {
  const result = state.map((value) => ({ ...value }))
  const targetMask = 1 << (qubits - 1 - gate.target)
  if (gate.type === 'Z') return result.map((value, index) => index & targetMask ? { re: -value.re, im: -value.im } : value)

  if (gate.type === 'CNOT') {
    const controlMask = 1 << (qubits - 1 - (gate.control ?? 0))
    for (let index = 0; index < state.length; index += 1) {
      if ((index & controlMask) && !(index & targetMask)) {
        const pair = index | targetMask
        result[index] = { ...state[pair] }; result[pair] = { ...state[index] }
      }
    }
    return result
  }

  for (let index = 0; index < state.length; index += 1) {
    if (index & targetMask) continue
    const pair = index | targetMask
    const a = state[index]; const b = state[pair]
    if (gate.type === 'X') {
      result[index] = { ...b }; result[pair] = { ...a }
    } else {
      result[index] = { re: (a.re + b.re) * Math.SQRT1_2, im: (a.im + b.im) * Math.SQRT1_2 }
      result[pair] = { re: (a.re - b.re) * Math.SQRT1_2, im: (a.im - b.im) * Math.SQRT1_2 }
    }
  }
  return result
}

function runCircuit(circuit: (Gate | null)[], through: number, qubits: number) {
  let state = zeroState(qubits)
  for (let column = 0; column < through; column += 1) {
    const gate = circuit[column]
    if (gate && gate.target < qubits && (gate.control === undefined || gate.control < qubits)) state = applyGate(state, gate, qubits)
  }
  return state
}

function label(index: number, qubits: number) { return index.toString(2).padStart(qubits, '0') }
function probability(value: Complex) { return (value.re * value.re + value.im * value.im) * 100 }
function amplitude(value: Complex) {
  const re = Math.abs(value.re) < 0.00001 ? 0 : value.re
  const im = Math.abs(value.im) < 0.00001 ? 0 : value.im
  return `${re.toFixed(3)} ${im < 0 ? '−' : '+'} ${Math.abs(im).toFixed(3)}i`
}

function describe(gate: Gate | null, step: number) {
  if (!step) return ['Initial state', 'Every qubit starts in |0⟩. No gates have been applied yet.']
  if (!gate) return [`Column ${step} is empty`, 'The state passes through this column unchanged.']
  const gateName = gate.name || gate.type
  if (gate.type === 'H') return [`${gateName} on q${gate.target}`, 'Creates a balanced superposition by mixing the |0⟩ and |1⟩ amplitudes.']
  if (gate.type === 'X') return [`${gateName} on q${gate.target}`, 'Flips this qubit between |0⟩ and |1⟩.']
  if (gate.type === 'Z') return [`${gateName} on q${gate.target}`, 'Flips the phase of its |1⟩ component. The probability may not change until later interference.']
  return [`${gateName}: q${gate.control} → q${gate.target}`, 'Flips the target only when the control is |1⟩. This can entangle the two qubits.']
}

function App() {
  const [qubits, setQubits] = useState(3)
  const [circuit, setCircuit] = useState<(Gate | null)[]>(initialCircuit)
  const [tool, setTool] = useState<Tool>('SELECT')
  const [heldKey, setHeldKey] = useState<GateType | null>(null)
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragSource, setDragSource] = useState<number | null>(null)
  const [dragTool, setDragTool] = useState<GateType | null>(null)
  const [dragHover, setDragHover] = useState<{ column: number; row: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [menu, setMenu] = useState<{ column: number; x: number; y: number } | null>(null)
  const [measurement, setMeasurement] = useState<string | null>(null)
  const [measurementHistory, setMeasurementHistory] = useState<string[]>([])
  const [undoStack, setUndoStack] = useState<(Gate | null)[][]>([])
  const [redoStack, setRedoStack] = useState<(Gate | null)[][]>([])
  const [guideMode, setGuideMode] = useState(false)
  const [guideIndex, setGuideIndex] = useState(0)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const previewCircuit = useMemo(() => {
    if (!dragHover || (!dragTool && dragSource === null)) return circuit
    const next = [...circuit]
    let gate = dragSource === null ? null : circuit[dragSource]
    if (!gate && dragTool) gate = { type: dragTool, target: dragHover.row }
    if (!gate) return circuit
    if (dragSource !== null && dragSource !== dragHover.column) next[dragSource] = null
    next[dragHover.column] = gate.type === 'CNOT'
      ? { ...gate, control: dragHover.row, target: dragHover.row === qubits - 1 ? dragHover.row - 1 : dragHover.row + 1 }
      : { ...gate, target: dragHover.row }
    return next
  }, [circuit, dragHover, dragSource, dragTool, qubits])

  const isPreviewing = previewCircuit !== circuit
  const displayStep = dragHover ? dragHover.column + 1 : step
  const state = useMemo(() => runCircuit(previewCircuit, displayStep, qubits), [previewCircuit, displayStep, qubits])
  const finalState = useMemo(() => runCircuit(circuit, circuit.length, qubits), [circuit, qubits])
  const rows = useMemo(() => state.map((value, index) => ({ index, value, p: probability(value) })).sort((a, b) => b.p - a.p), [state])
  const qubitProbabilities = useMemo(() => Array.from({ length: qubits }, (_, qubit) => {
    const mask = 1 << (qubits - 1 - qubit)
    return state.reduce((sum, value, index) => sum + (index & mask ? probability(value) : 0), 0)
  }), [state, qubits])
  const [explanationTitle, explanationBody] = describe(displayStep ? previewCircuit[displayStep - 1] : null, displayStep)
  const measuredIndex = measurement ? Number.parseInt(measurement, 2) : 0
  const measuredProbability = measurement ? probability(finalState[measuredIndex]) : 0
  const meaningfulSteps = useMemo(() => [0, ...circuit.flatMap((gate, index) => gate ? [index + 1] : [])], [circuit])
  const stepPosition = meaningfulSteps.indexOf(step)
  const measurementCounts = useMemo(() => measurementHistory.reduce<Record<string, number>>((counts, result) => {
    counts[result] = (counts[result] || 0) + 1
    return counts
  }, {}), [measurementHistory])

  function commitCircuit(update: (current: (Gate | null)[]) => (Gate | null)[]) {
    setCircuit((current) => {
      const next = update(current)
      if (next === current) return current
      setUndoStack((history) => [...history.slice(-39), current])
      setRedoStack([])
      return next
    })
    setMeasurement(null); setMeasurementHistory([])
  }

  function undo() {
    if (!undoStack.length) return
    const previous = undoStack[undoStack.length - 1]
    setUndoStack((history) => history.slice(0, -1)); setRedoStack((history) => [circuit, ...history])
    setCircuit(previous); setStep((current) => Math.min(current, previous.length)); setSelected(new Set()); setMeasurement(null); setMeasurementHistory([])
  }

  function redo() {
    if (!redoStack.length) return
    const next = redoStack[0]
    setRedoStack((history) => history.slice(1)); setUndoStack((history) => [...history, circuit])
    setCircuit(next); setStep((current) => Math.min(current, next.length)); setSelected(new Set()); setMeasurement(null); setMeasurementHistory([])
  }

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement).tagName === 'INPUT') return
      const key = event.key.toUpperCase()
      if (['H', 'X', 'Z'].includes(key)) setHeldKey(key as GateType)
      if (key === 'C') setHeldKey('CNOT')
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size) {
        event.preventDefault()
        commitCircuit((current) => current.map((gate, index) => selected.has(index) ? null : gate))
        setSelected(new Set())
      }
      if (event.key === 'Escape') { setSelected(new Set()); setMenu(null); setTool('SELECT') }
    }
    function keyUp(event: KeyboardEvent) {
      if (['H', 'X', 'Z', 'C'].includes(event.key.toUpperCase())) setHeldKey(null)
    }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) }
  }, [selected])

  function makeGate(type: GateType, row: number): Gate {
    if (type === 'CNOT') return { type, control: row, target: row === qubits - 1 ? row - 1 : row + 1 }
    return { type, target: row }
  }

  function interact(column: number, row: number) {
    const activeTool = heldKey || tool
    if (activeTool === 'SELECT') {
      if (circuit[column]) setSelected((current) => new Set(current.has(column) ? [] : [column]))
      else setSelected(new Set())
      setStep(column + 1); return
    }
    commitCircuit((current) => current.map((gate, index) => index === column ? activeTool === 'ERASE' ? null : makeGate(activeTool, row) : gate))
    setSelected(activeTool === 'ERASE' ? new Set() : new Set([column])); setStep(column + 1); setMeasurement(null)
  }

  function beginDrag(event: DragEvent, type: GateType | null, source: number | null) {
    if (type) event.dataTransfer.setData('gate-type', type)
    if (source !== null) event.dataTransfer.setData('gate-source', String(source))
    event.dataTransfer.effectAllowed = source === null ? 'copy' : 'move'
    setDragTool(type); setDragSource(source)
  }

  function finishDrop(event: DragEvent, column: number, row: number) {
    event.preventDefault()
    const sourceText = event.dataTransfer.getData('gate-source')
    const source = sourceText === '' ? null : Number(sourceText)
    const type = (event.dataTransfer.getData('gate-type') || dragTool) as GateType | null
    let gate = source === null ? null : circuit[source]
    if (!gate && type) gate = makeGate(type, row)
    if (!gate) return
    const moved = gate.type === 'CNOT' ? { ...gate, control: row, target: row === qubits - 1 ? row - 1 : row + 1 } : { ...gate, target: row }
    commitCircuit((current) => current.map((value, index) => index === column ? moved : index === source && source !== column ? null : value))
    setStep(column + 1); setSelected(new Set([column])); endDrag()
  }

  function endDrag() { setDragSource(null); setDragTool(null); setDragHover(null) }

  function middleDown(event: MouseEvent, column: number) {
    if (event.button !== 1 || !circuit[column]) return
    event.preventDefault(); setDragSource(column); setSelected(new Set([column]))
  }

  function middleUp(event: MouseEvent, column: number, row: number) {
    if (event.button !== 1 || dragSource === null) return
    event.preventDefault()
    const gate = circuit[dragSource]
    if (gate) {
      const moved = gate.type === 'CNOT' ? { ...gate, control: row, target: row === qubits - 1 ? row - 1 : row + 1 } : { ...gate, target: row }
      commitCircuit((current) => current.map((value, index) => index === column ? moved : index === dragSource && dragSource !== column ? null : value))
      setStep(column + 1); setSelected(new Set([column]))
    }
    endDrag()
  }

  function startBox(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.slot')) return
    const rect = gridRef.current?.getBoundingClientRect(); if (!rect) return
    const x = event.clientX - rect.left; const y = event.clientY - rect.top
    setBox({ x1: x, y1: y, x2: x, y2: y }); setSelected(new Set())
  }

  function moveBox(event: MouseEvent<HTMLDivElement>) {
    if (!box) return
    const rect = gridRef.current?.getBoundingClientRect(); if (!rect) return
    setBox({ ...box, x2: event.clientX - rect.left, y2: event.clientY - rect.top })
  }

  function endBox() {
    if (!box || !gridRef.current) return
    const gridRect = gridRef.current.getBoundingClientRect()
    const left = Math.min(box.x1, box.x2) + gridRect.left; const right = Math.max(box.x1, box.x2) + gridRect.left
    const top = Math.min(box.y1, box.y2) + gridRect.top; const bottom = Math.max(box.y1, box.y2) + gridRect.top
    const crossing = box.x2 < box.x1
    const hits = new Set<number>()
    gridRef.current.querySelectorAll<HTMLElement>('[data-gate-column]').forEach((element) => {
      const r = element.getBoundingClientRect(); const column = Number(element.dataset.gateColumn)
      const touched = r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom
      const enclosed = r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom
      if (crossing ? touched : enclosed) hits.add(column)
    })
    setSelected(hits); setBox(null)
  }

  function openMenu(event: MouseEvent, column: number) {
    if (!circuit[column]) return
    event.preventDefault(); setSelected(new Set([column]))
    setMenu({ column, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 145) })
  }

  function resizeQubits(delta: number) {
    const next = Math.min(MAX_QUBITS, Math.max(MIN_QUBITS, qubits + delta))
    setQubits(next)
    commitCircuit((current) => current.map((gate) => gate && (gate.target >= next || (gate.control ?? 0) >= next) ? null : gate))
    setSelected(new Set()); setMeasurement(null)
  }

  function resizeColumns(delta: number) {
    const nextLength = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, circuit.length + delta))
    if (nextLength === circuit.length) return
    commitCircuit((current) => nextLength > current.length
      ? [...current, ...Array(nextLength - current.length).fill(null)]
      : current.slice(0, nextLength))
    setStep((current) => Math.min(current, nextLength))
    setSelected((current) => new Set([...current].filter((column) => column < nextLength)))
    setMeasurement(null)
  }

  function sampleMeasurement() {
    let random = Math.random(); let result = 0
    for (let index = 0; index < finalState.length; index += 1) { random -= probability(finalState[index]) / 100; if (random <= 0) { result = index; break } }
    return label(result, qubits)
  }

  function measure() {
    const result = sampleMeasurement()
    setMeasurement(result); setMeasurementHistory((history) => [...history, result]); setStep(meaningfulSteps[meaningfulSteps.length - 1])
  }

  function measureMany(amount: number) {
    const results = Array.from({ length: amount }, sampleMeasurement)
    setMeasurement(results[results.length - 1]); setMeasurementHistory((history) => [...history, ...results]); setStep(meaningfulSteps[meaningfulSteps.length - 1])
  }

  function startGuide() {
    setGuideMode(true); setGuideIndex(0); setQubits(2); setStep(0); setSelected(new Set()); setMeasurement(null); setMeasurementHistory([])
    commitCircuit(() => Array(6).fill(null))
  }

  const boxStyle = box ? { left: Math.min(box.x1, box.x2), top: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) } : undefined

  return <main onClick={() => menu && setMenu(null)}>
    <header className="site-header"><div className="wordmark"><span><i>•</i><i>•</i><b>⌣</b></span> Quantum Circuit Simulation</div><div className="header-actions"><button onClick={() => setGlossaryOpen((open) => !open)}>Glossary</button><button onClick={startGuide}>Guided lesson</button><button onClick={() => { commitCircuit(() => initialCircuit); setQubits(3); setStep(0); setSelected(new Set()); setGuideMode(false) }}>Load full example</button></div></header>
    <section className="page-heading"><div className="heading-copy"><h1>Build a Quantum Circuit</h1><p>Pick up a gate, drop it on a wire, and watch the quantum state change!</p></div><div className="quantum-mascot" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="mascot-face"><i>•</i><i>•</i><b>⌣</b></div><span className="spark spark-one">✦</span><span className="spark spark-two">✦</span></div><div className="size-controls"><span>{qubits} qubits · {circuit.length} columns</span><button onClick={() => resizeQubits(-1)} disabled={qubits === MIN_QUBITS}>− q</button><button onClick={() => resizeQubits(1)} disabled={qubits === MAX_QUBITS}>+ q</button><button onClick={() => resizeColumns(-2)} disabled={circuit.length === MIN_COLUMNS}>− columns</button><button onClick={() => resizeColumns(2)} disabled={circuit.length === MAX_COLUMNS}>+ columns</button></div></section>

    {glossaryOpen && <section className="glossary-panel"><div className="panel-title"><div><span>QUICK REFERENCE</span><h2>Quantum Glossary</h2></div><button onClick={() => setGlossaryOpen(false)}>Close</button></div><div className="glossary-grid">{glossary.map(([term, definition]) => <div key={term}><strong>{term}</strong><p>{definition}</p></div>)}</div></section>}
    {guideMode && <section className="guide-panel"><div className="guide-progress">{guideSteps.map((_, index) => <i key={index} className={index <= guideIndex ? 'complete' : ''}>{index + 1}</i>)}</div><div><span>GUIDED LESSON · STEP {guideIndex + 1}</span><h2>{guideSteps[guideIndex][0]}</h2><p>{guideSteps[guideIndex][1]}</p></div><div className="guide-buttons"><button onClick={() => setGuideIndex((index) => Math.max(0, index - 1))} disabled={!guideIndex}>Back</button><button onClick={() => setGuideIndex((index) => Math.min(guideSteps.length - 1, index + 1))} disabled={guideIndex === guideSteps.length - 1}>Next instruction</button><button onClick={() => setGuideMode(false)}>Exit lesson</button></div></section>}

    <section className="builder-panel">
      <aside className="toolbox"><div className="toolbox-label"><strong>Toolbox</strong><span>Drag a gate onto a wire</span></div>
        <div className="tool-section"><div className="tool-group-label">Edit</div><div className="tool-buttons"><button className={tool === 'SELECT' ? 'active' : ''} onClick={() => setTool('SELECT')}><strong>↖</strong><span>Select</span></button><button className={tool === 'ERASE' ? 'active erase' : 'erase'} onClick={() => setTool('ERASE')}><strong>×</strong><span>Remove</span></button></div></div>
        <div className="tool-section"><div className="tool-group-label">Gates</div><div className="tool-buttons">
          {(['H', 'X', 'Z', 'CNOT'] as GateType[]).map((type) => {
            const details = gateDetails[type]
            return <button key={type} draggable aria-label={`${type}: ${gateHelp[type]}`} aria-describedby={`gate-help-${type}`} onDragStart={(e) => beginDrag(e, type, null)} onDragEnd={endDrag} className={`tool-gate ${tool === type ? 'active' : ''}`} onClick={() => setTool(type)}>
              <strong>{type === 'CNOT' ? '●' : type}</strong><span>{type === 'H' ? 'Hadamard' : type === 'X' ? 'Bit flip' : type === 'Z' ? 'Phase flip' : 'Controlled X'}</span>
              <div className="gate-help-card" id={`gate-help-${type}`} role="tooltip">
                <div className="gate-help-heading"><b>{details.name}</b><code>{type === 'CNOT' ? '●—⊕' : type}</code></div>
                <p>{details.description}</p>
                <div className="matrix-section"><span>Matrix</span><div className="matrix-wrap">{details.factor && <i>{details.factor}</i>}<div className={`matrix matrix-${details.matrix.length}`}>{details.matrix.flat().map((value, index) => <code key={index}>{value}</code>)}</div></div></div>
                <div className="gate-example"><span>Example</span><code>{details.example}</code></div>
              </div>
            </button>
          })}
        </div></div>
        <div className="toolbox-shortcuts"><b>Shortcuts</b><span><kbd>H</kbd><kbd>X</kbd><kbd>Z</kbd><kbd>C</kbd> + click to place</span><span><kbd>Del</kbd> remove selected</span><span>Drag → enclosed · Drag ← touched</span></div>
      </aside>

      <div className="circuit-area">
        <div className="circuit-help"><span>{isPreviewing ? 'Previewing state at drop position' : heldKey ? `${heldKey} shortcut active — click to place` : 'Drag to build · middle-drag to move · right-click to rename'}</span><div><button onClick={undo} disabled={!undoStack.length}>Undo</button><button onClick={redo} disabled={!redoStack.length}>Redo</button><button onClick={() => { commitCircuit(() => Array(circuit.length).fill(null)); setSelected(new Set()); setStep(0) }}>Clear</button></div></div>
        <div ref={gridRef} className={`circuit-grid ${isPreviewing ? 'previewing' : ''}`} style={{ gridTemplateColumns: `64px repeat(${circuit.length}, minmax(66px, 1fr)) 52px`, height: qubits * 64 + 70 }} onMouseDown={startBox} onMouseMove={moveBox} onMouseUp={endBox} onMouseLeave={() => box && endBox()}>
          {Array.from({ length: qubits }, (_, row) => <div key={`label-${row}`} className="row-name" style={{ top: row * 64 + 31 }}><strong>q{row}</strong><span>|0⟩</span></div>)}
          {Array.from({ length: qubits }, (_, row) => <div key={`wire-${row}`} className="wire" style={{ top: row * 64 + 40 }} />)}
          {circuit.map((gate, column) => <div className={`column ${step === column + 1 ? 'current' : ''}`} style={{ gridColumn: column + 2, height: qubits * 64 + 45 }} key={column}>
            {Array.from({ length: qubits }, (_, row) => {
              const isGateRow = gate && (gate.target === row || gate.control === row)
              return <button key={row} className={`slot ${selected.has(column) && isGateRow ? 'selected' : ''} ${dragHover?.column === column && dragHover.row === row ? 'drop-hover' : ''}`} data-tooltip={isGateRow && gate ? gateHelp[gate.type] : undefined} aria-label={isGateRow && gate ? `${gate.name || gate.type}: ${gateHelp[gate.type]}` : `Empty slot, q${row}, column ${column + 1}`} style={{ top: row * 64 + 16 }} draggable={Boolean(gate && isGateRow)} onDragStart={(e) => beginDrag(e, null, column)} onDragEnd={endDrag} onDragOver={(e) => { e.preventDefault(); setDragHover({ column, row }) }} onDrop={(e) => finishDrop(e, column, row)} onMouseDown={(e) => middleDown(e, column)} onMouseUp={(e) => middleUp(e, column, row)} onContextMenu={(e) => openMenu(e, column)} onClick={() => interact(column, row)}>
                {gate?.type !== 'CNOT' && gate?.target === row && <span className={`gate gate-${gate.type.toLowerCase()}`} data-gate-column={column}>{gate.name || gate.type}</span>}
                {gate?.type === 'CNOT' && gate.control === row && <><span className="control" data-gate-column={column} /><i className="control-line" style={{ height: Math.abs(gate.target - gate.control) * 64, top: gate.target > gate.control ? 24 : 24 - Math.abs(gate.target - gate.control) * 64 }} /></>}
                {gate?.type === 'CNOT' && gate.target === row && <span className="target" data-gate-column={column}>⊕</span>}
              </button>
            })}
            <button className="column-number" onClick={() => setStep(column + 1)} style={{ top: qubits * 64 + 20 }}>{column + 1}</button>
          </div>)}
          {Array.from({ length: qubits }, (_, row) => <div key={`m-${row}`} className="measurement" style={{ top: row * 64 + 16 }}><strong>M</strong><span>P(1) {qubitProbabilities[row].toFixed(0)}%</span></div>)}
          {box && <div className={`selection-box ${box.x2 < box.x1 ? 'crossing' : ''}`} style={boxStyle} />}
        </div>
        <div className="circuit-footer"><button onClick={() => setStep(meaningfulSteps[Math.max(0, (stepPosition < 0 ? meaningfulSteps.findIndex((value) => value > step) : stepPosition) - 1)])} disabled={step <= meaningfulSteps[0]}>← Previous</button><input aria-label="Circuit step" type="range" min="0" max={meaningfulSteps.length - 1} value={Math.max(0, stepPosition)} onChange={(e) => setStep(meaningfulSteps[Number(e.target.value)])}/><span>{stepPosition < 0 ? `Empty column ${step}` : `Step ${stepPosition} / ${meaningfulSteps.length - 1}`}</span><button onClick={() => { const next = meaningfulSteps.find((value) => value > step); if (next !== undefined) setStep(next) }} disabled={!meaningfulSteps.some((value) => value > step)}>Next →</button></div>
      </div>
    </section>

    <section className="readout-grid">
      <article className="explanation"><div className="section-label">{isPreviewing ? `PREVIEWING STEP ${displayStep}` : `STEP ${Math.max(0, stepPosition)}`}</div><h2>{explanationTitle}</h2><p>{explanationBody}</p>{step > 0 && circuit[step - 1] && <div className="before-after"><strong>State Change</strong><div><section><small>BEFORE</small><span>{runCircuit(circuit, step - 1, qubits).map(probability).map((p, index) => p > .01 ? `|${label(index, qubits)}⟩ ${p.toFixed(0)}%` : '').filter(Boolean).slice(0, 2).join('  ·  ')}</span></section><b>↓</b><section><small>AFTER</small><span>{state.map(probability).map((p, index) => p > .01 ? `|${label(index, qubits)}⟩ ${p.toFixed(0)}%` : '').filter(Boolean).slice(0, 2).join('  ·  ')}</span></section></div></div>}</article>
      <article className="probabilities"><div className="article-heading"><div><div className="section-label">{isPreviewing ? 'LIVE DRAG PREVIEW' : 'STATE AT THIS STEP'}</div><h2>Most Likely Outcomes</h2></div><span>{2 ** qubits} basis states</span></div><div className="bars">{rows.slice(0, 8).map(({ index, p }) => <div className="bar-row" key={index}><code>|{label(index, qubits)}⟩</code><div className="bar-track"><i style={{ width: `${p}%` }} /></div><strong>{p.toFixed(1)}%</strong></div>)}</div></article>
      <article className="state-vector"><div className="section-label">AMPLITUDES & PHASE</div><h2>State Vector</h2><div className="phase-key"><span>→ 0° positive</span><span>← 180° negative</span></div><div className="vector-table">{rows.filter((row) => row.p > .0001).slice(0, 10).map(({ index, value, p }) => { const phase = Math.round(Math.atan2(value.im, value.re) * 180 / Math.PI); return <div key={index}><code>|{label(index, qubits)}⟩</code><code>{amplitude(value)}</code><span className="phase-arrow" style={{ transform: `rotate(${phase}deg)` }}>→</span><small>{phase}° · {p.toFixed(1)}%</small></div> })}</div>{rows.filter((row) => row.p > .0001).length > 10 && <p className="more-states">Showing 10 non-zero states</p>}</article>
    </section>

    <section className="measure-panel"><div className="measure-intro"><h2>Measurement</h2><p>Sample the completed circuit once or repeat it to see the pattern.</p></div>{measurement && <div className="measurement-answer"><div className="measured-result"><span>Latest measurement</span><strong>|{measurement}⟩</strong><b>Expected: {measuredProbability.toFixed(1)}%</b></div><div className="result-details"><span><strong>Qubit reading</strong>{measurement.split('').map((bit, index) => `q${index}=${bit}`).join(' · ')}</span><span><strong>Total trials</strong>{measurementHistory.length}</span></div>{measurementHistory.length > 1 && <div className="history-chart"><h3>Observed Results</h3>{Object.entries(measurementCounts).sort().map(([result, count]) => <div key={result}><code>|{result}⟩</code><span><i style={{ width: `${count / measurementHistory.length * 100}%` }}/></span><b>{count} / {measurementHistory.length} ({(count / measurementHistory.length * 100).toFixed(0)}%)</b></div>)}</div>}</div>}<div className="measure-actions"><button onClick={measure}>Measure once</button><button onClick={() => measureMany(100)}>Run 100</button>{measurementHistory.length > 0 && <button className="clear-history" onClick={() => { setMeasurementHistory([]); setMeasurement(null) }}>Clear results</button>}</div></section>

    {menu && circuit[menu.column] && <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}><label>Gate name<input autoFocus value={circuit[menu.column]?.name || ''} placeholder={circuit[menu.column]?.type} onChange={(e) => commitCircuit((current) => current.map((gate, index) => index === menu.column && gate ? { ...gate, name: e.target.value } : gate))} /></label><button onClick={() => { commitCircuit((current) => current.map((gate, index) => index === menu.column ? null : gate)); setMenu(null) }}>Delete gate</button></div>}
  </main>
}

export default App
