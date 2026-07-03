import { useState, useEffect } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Cache the user ID so it doesn't change on hot reload, but stays unique per session
const MOCK_USER_ID = sessionStorage.getItem('mockUserId') || (() => {
  const newId = 'User_' + crypto.randomUUID().split('-')[0].toUpperCase();
  sessionStorage.setItem('mockUserId', newId);
  return newId;
})();

function App() {
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trackerLogs, setTrackerLogs] = useState([]);
  const [testSeatId, setTestSeatId] = useState('');

  const fetchSeats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/seats`);
      const data = await res.json();
      setSeats(data.data);
    } catch (err) {
      console.error('Error fetching seats:', err);
    } finally {
      if (loading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeats();
    const interval = setInterval(fetchSeats, 2000);
    return () => clearInterval(interval);
  }, []);

  const addTrackerLog = (req) => {
    setTrackerLogs((prev) => [req, ...prev]);
  };

  const handleSeatClick = (seat) => {
    if (seat.status === 'AVAILABLE') {
      return handleBook(seat);
    }
    // If it's pending and belongs to us, clicking it will confirm it
    if (seat.status === 'PENDING' && seat.userId === MOCK_USER_ID) {
      return handleConfirm(seat);
    }
  };

  const handleBook = async (seat) => {
    const reqStart = performance.now();
    const reqId = Math.floor(Math.random() * 1000);

    addTrackerLog({
      id: reqId,
      time: new Date().toLocaleTimeString(),
      target: seat.seatNumber,
      latency: null,
      status: 'SENDING...',
      statusCode: 0,
      response: 'Processing booking...'
    });

    const idempotencyKey = crypto.randomUUID();
    let finalLog = null;

    try {
      const res = await fetch(`${API_BASE}/api/book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({ seatId: seat.id, userId: MOCK_USER_ID })
      });

      const latency = Math.round(performance.now() - reqStart);
      const data = await res.json();

      finalLog = {
        id: reqId,
        time: new Date().toLocaleTimeString(),
        target: seat.seatNumber,
        latency,
        status: res.ok ? 'SUCCESS' : 'CONFLICT',
        statusCode: res.status,
        response: res.ok ? data.message : data.error
      };

      if (res.ok) {
        fetchSeats();
      }
    } catch (err) {
      finalLog = {
        id: reqId,
        time: new Date().toLocaleTimeString(),
        target: seat.seatNumber,
        latency: Math.round(performance.now() - reqStart),
        status: 'NETWORK ERROR',
        statusCode: 500,
        response: err.message
      };
    }

    setTrackerLogs(prev => prev.map(l => l.id === reqId ? finalLog : l));
  };

  const handleConfirm = async (seat) => {
    try {
      const res = await fetch(`${API_BASE}/api/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatId: seat.id, userId: MOCK_USER_ID })
      });
      if (res.ok) {
        fetchSeats();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReset = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
      if (res.ok) {
        setTrackerLogs([]); // Clear logs for a fresh start
        fetchSeats();
        setTestSeatId('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const testConcurrency = async () => {
    if (!testSeatId) return alert('Please select a target seat from the dropdown first.');
    const targetSeat = seats.find(s => s.id === parseInt(testSeatId));
    if (!targetSeat) return alert('Invalid seat or seat no longer exists.');
    if (targetSeat.status !== 'AVAILABLE') return alert('Target seat is no longer AVAILABLE! Please reset or select another.');

    setTrackerLogs([]);

    const requestsCount = 5;
    const basePayloads = Array.from({ length: requestsCount }).map((_, i) => ({
      reqId: `TestReq_${i + 1}`,
      seatId: targetSeat.id,
      seatNumber: targetSeat.seatNumber,
      userId: `VirtualUser_${i + 1}`,
      idempotency: crypto.randomUUID()
    }));

    setTrackerLogs(basePayloads.map(p => ({
      id: p.reqId,
      time: new Date().toLocaleTimeString(),
      target: p.seatNumber,
      latency: null,
      status: 'DISPATCHING...',
      statusCode: 0,
      response: `Firing request via VirtualUser_${p.reqId.split('_')[1]}`
    })));

    const promises = basePayloads.map(async p => {
      const reqStart = performance.now();
      try {
        const res = await fetch(`${API_BASE}/api/book`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'idempotency-key': p.idempotency
          },
          body: JSON.stringify({ seatId: p.seatId, userId: p.userId })
        });
        const data = await res.json();

        return {
          id: p.reqId,
          time: new Date().toLocaleTimeString(),
          target: p.seatNumber,
          latency: Math.round(performance.now() - reqStart),
          status: res.ok ? 'LOCKED' : 'BLOCKED',
          statusCode: res.status,
          response: JSON.stringify(data)
        };
      } catch (err) {
        return {
          id: p.reqId,
          time: new Date().toLocaleTimeString(),
          target: p.seatNumber,
          latency: Math.round(performance.now() - reqStart),
          status: 'ERROR',
          statusCode: 500,
          response: err.message
        }
      }
    });

    const results = await Promise.all(promises);
    setTrackerLogs(results.reverse());
    fetchSeats();
  };

  const getSeatStyling = (seat) => {
    let classes = `seat ${seat.status}`;
    // Visually indicate the user's own pending seats to click
    if (seat.status === 'PENDING' && seat.userId === MOCK_USER_ID) {
      classes += ' my-pending';
    }
    return classes;
  };

  return (
    <div className="container">
      <h1>Booking Engine Simulator</h1>
      <p className="subtitle">High-Concurrency Distributed Lock Viewer</p>

      <div className="dashboard-layout">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Seat Availability</h2>
            <div className="seat-legend">
              <div className="legend-item"><div className="legend-color" style={{ background: '#e0f2fe', borderColor: '#bae6fd' }}></div> Available</div>
              <div className="legend-item"><div className="legend-color" style={{ background: '#fef08a', borderColor: '#fde047' }}></div> Pending</div>
              <div className="legend-item"><div className="legend-color" style={{ background: '#fecaca', borderColor: '#fca5a5' }}></div> Booked</div>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '15px' }}>Tip: Click an available seat to lock it. If a seat is pending and belongs to you, click it again to confirm payment.</p>

          <div className="seat-grid">
            {loading ? (
              <p>Loading...</p>
            ) : (
              seats.map(seat => (
                <div
                  key={seat.id}
                  className={getSeatStyling(seat)}
                  onClick={() => handleSeatClick(seat)}
                  title={seat.userId ? `Owned by: ${seat.userId}` : 'Available'}
                >
                  {seat.seatNumber}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="panel">
            <h2>Controls</h2>
            <div className="user-tag">Session ID: {MOCK_USER_ID}</div>

            <button onClick={fetchSeats}>Refresh Layout</button>
            <button onClick={handleReset} style={{ marginTop: '10px', background: '#475569' }}>
              Reset All Seats to Available
            </button>

            <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '15px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', color: '#334155', fontWeight: 500 }}>Target Seat for Load Test</label>
              <select
                value={testSeatId}
                onChange={(e) => setTestSeatId(e.target.value)}
                style={{ width: '100%', padding: '8px', marginBottom: '10px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
              >
                <option value="">-- Select an Available Seat --</option>
                {seats.filter(s => s.status === 'AVAILABLE').map(s => (
                  <option key={s.id} value={s.id}>{s.seatNumber}</option>
                ))}
              </select>

              <button className="test-btn" onClick={testConcurrency} disabled={!testSeatId}>
                Fire Concurrent Load Test (5 reqs)
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Live HTTP Tracker</h2>
            <div className="tracker-list">
              {trackerLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '0.9rem' }}>
                  Waiting for activity...
                </div>
              ) : (
                trackerLogs.map(log => (
                  <div key={log.id} className="req-card">
                    <div className="req-header">
                      <span>{log.id} → {log.target}</span>
                      <span>{log.time} {log.latency && `(${log.latency}ms)`}</span>
                    </div>
                    <div className={`req-status status-${log.statusCode}`}>
                      [{log.statusCode}] {log.status}
                    </div>
                    <div className="req-payload">
                      {log.response}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
