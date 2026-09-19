import React, { useState, useEffect, useCallback, useRef } from "react";
import { storage, subscribeToKey } from "./storage.js";
import { Undo2, Trophy, RotateCcw, ChevronDown, ChevronUp, X, Save, Search, Instagram, RefreshCw, ArrowLeft } from "lucide-react";

const WICKET_TYPES = ["Bowled", "Caught", "LBW", "Run Out", "Stumped", "Hit Wicket"];
const ROLES = ["Batsman", "Bowler", "All-rounder"];
const SQUAD_SIZE = 11;
const MATCH_KEY = "cricket-match-live";
const PLAYERS_KEY = "cricket-players-directory";
const INSTAGRAM_URL = "https://www.instagram.com/pujandar_45?igsh=bGxhcm44ZHF5aWtp&utm_source=qr";

const emptyBatsman = () => ({ runs: 0, balls: 0, fours: 0, sixes: 0, out: false, howOut: "" });
const emptyBowler = () => ({ balls: 0, runs: 0, wickets: 0, maidens: 0 });
const emptyPlayer = (id, name, role) => ({
  id, name, role, matches: 0, runs: 0, balls: 0, fours: 0, sixes: 0, ballsBowled: 0, runsConceded: 0, wickets: 0,
});
const freshSquadRows = () => Array.from({ length: SQUAD_SIZE }, () => ({ id: null, name: "", role: "Batsman" }));

function newInnings(battingTeam, bowlingTeam) {
  return {
    battingTeam,
    bowlingTeam,
    runs: 0,
    wickets: 0,
    balls: 0,
    extras: { wd: 0, nb: 0, b: 0, lb: 0 },
    batsmen: {},
    bowlers: {},
    order: [],
    playerIds: {},
    striker: "",
    nonStriker: "",
    bowler: "",
    previousBowler: "",
    thisOver: [],
    ticker: [],
    completed: false,
  };
}

function oversStr(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function avatarColor(role) {
  if (role === "Bowler") return "var(--blue)";
  if (role === "All-rounder") return "var(--purple)";
  return "var(--leather)";
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function tokenClass(t) {
  if (t.type === "W") return "tok tok-w";
  if (t.type === "extra") return "tok tok-e";
  if (t.runs === 4) return "tok tok-4";
  if (t.runs === 6) return "tok tok-6";
  if (t.runs === 0) return "tok tok-0";
  return "tok tok-r";
}

function newPlayerId() {
  return "P" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Turns 11 squad-entry rows into finalized {id,name,role} entries, reusing an
// existing player's id (by explicit selection, or by exact name match) or
// generating a brand-new id. Mutates `pl` (the shared players directory).
function finalizeSquad(pl, rows) {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      let id = r.id;
      const trimmed = r.name.trim();
      if (!id) {
        const key = trimmed.toLowerCase();
        id = Object.keys(pl).find((k) => pl[k].name.toLowerCase() === key);
      }
      if (!id) {
        id = newPlayerId();
        pl[id] = emptyPlayer(id, trimmed, r.role);
      }
      pl[id].matches += 1;
      return { id, name: pl[id].name, role: pl[id].role };
    });
}

export default function CricketScorer() {
  const [loaded, setLoaded] = useState(false);
  const [match, setMatch] = useState(null);
  const [players, setPlayers] = useState({});
  const [history, setHistory] = useState([]);

  const [setupStage, setSetupStage] = useState("teams"); // teams -> squadA -> squadB
  const [setup, setSetup] = useState({ team1: "", team2: "", overs: 20 });
  const [squadA, setSquadA] = useState(freshSquadRows());
  const [squadB, setSquadB] = useState(freshSquadRows());
  const [squadError, setSquadError] = useState("");

  const [openersPrompt, setOpenersPrompt] = useState(null); // 1 or 2
  const [openerSel, setOpenerSel] = useState({ striker: "", nonStriker: "", bowler: "" });

  const [wicketModal, setWicketModal] = useState(false);
  const [wicketType, setWicketType] = useState("Bowled");
  const [newBatsmanName, setNewBatsmanName] = useState("");
  const [nextBowlerSel, setNextBowlerSel] = useState("");
  const [extraRunsModal, setExtraRunsModal] = useState(null); // 'wd' | 'nb'
  const [showScorecard, setShowScorecard] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [bowlerError, setBowlerError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const matchSaveTimer = useRef(null);
  const playersSaveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(MATCH_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          // Guard against matches saved by an older version of this app
          // (before squads existed) — loading those would crash the UI.
          const looksValid =
            parsed && parsed.squads && parsed.team1 in parsed.squads && parsed.team2 in parsed.squads && Array.isArray(parsed.inningsData);
          if (looksValid) {
            setMatch(parsed);
          } else {
            try { await storage.delete(MATCH_KEY); } catch (e2) {}
          }
        }
      } catch (e) {}
      try {
        const res2 = await storage.get(PLAYERS_KEY);
        if (res2 && res2.value) setPlayers(JSON.parse(res2.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  // Live sync: whenever anyone (including this tab) writes a new value for
  // the match or the players directory, every open browser picks it up
  // automatically via Supabase realtime — this is what makes the match
  // "watchable" by other people in real time.
  useEffect(() => {
    const unsubMatch = subscribeToKey(MATCH_KEY, (value, wasDeleted) => {
      if (wasDeleted) {
        setMatch(null);
        return;
      }
      if (!value) return;
      try {
        const parsed = JSON.parse(value);
        const looksValid =
          parsed && parsed.squads && parsed.team1 in parsed.squads && parsed.team2 in parsed.squads && Array.isArray(parsed.inningsData);
        if (looksValid) setMatch(parsed);
      } catch (e) {}
    });
    const unsubPlayers = subscribeToKey(PLAYERS_KEY, (value) => {
      if (!value) return;
      try {
        setPlayers(JSON.parse(value));
      } catch (e) {}
    });
    return () => {
      unsubMatch();
      unsubPlayers();
    };
  }, []);

  useEffect(() => {
    if (!loaded || !match) return;
    if (matchSaveTimer.current) clearTimeout(matchSaveTimer.current);
    matchSaveTimer.current = setTimeout(async () => {
      try {
        await storage.set(MATCH_KEY, JSON.stringify(match));
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 900);
      } catch (e) {
        console.error("save failed", e);
      }
    }, 500);
    return () => clearTimeout(matchSaveTimer.current);
  }, [match, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (playersSaveTimer.current) clearTimeout(playersSaveTimer.current);
    playersSaveTimer.current = setTimeout(async () => {
      try {
        await storage.set(PLAYERS_KEY, JSON.stringify(players));
      } catch (e) {
        console.error("player save failed", e);
      }
    }, 500);
    return () => clearTimeout(playersSaveTimer.current);
  }, [players, loaded]);

  const pushHistory = useCallback((m, p) => {
    setHistory((h) => [...h.slice(-29), { match: deepClone(m), players: deepClone(p) }]);
  }, []);

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setMatch(prev.match);
      setPlayers(prev.players);
      return h.slice(0, -1);
    });
  };

  // ---------- SETUP FLOW ----------
  const confirmTeams = () => {
    if (!setup.team1.trim() || !setup.team2.trim()) return;
    setSquadA(freshSquadRows());
    setSquadError("");
    setSetupStage("squadA");
  };

  const confirmSquadA = () => {
    const filled = squadA.filter((r) => r.name.trim()).length;
    if (filled < SQUAD_SIZE) {
      setSquadError(`Add all ${SQUAD_SIZE} players for ${setup.team1.trim()} (${filled}/${SQUAD_SIZE} so far).`);
      return;
    }
    setSquadError("");
    setSquadB(freshSquadRows());
    setSetupStage("squadB");
  };

  const confirmSquadB = () => {
    const filled = squadB.filter((r) => r.name.trim()).length;
    if (filled < SQUAD_SIZE) {
      setSquadError(`Add all ${SQUAD_SIZE} players for ${setup.team2.trim()} (${filled}/${SQUAD_SIZE} so far).`);
      return;
    }
    const pl = deepClone(players);
    const teamAFinal = finalizeSquad(pl, squadA);
    const teamBFinal = finalizeSquad(pl, squadB);
    const team1 = setup.team1.trim();
    const team2 = setup.team2.trim();
    const m = {
      team1,
      team2,
      oversLimit: Number(setup.overs) || 20,
      innings: 1,
      inningsData: [newInnings(team1, team2), null],
      result: null,
      seenPlayers: teamAFinal.concat(teamBFinal).map((p) => p.id),
      squads: { [team1]: teamAFinal, [team2]: teamBFinal },
    };
    setPlayers(pl);
    setMatch(m);
    setOpenerSel({ striker: "", nonStriker: "", bowler: "" });
    setOpenersPrompt(1);
    setSetupStage("teams");
    setSquadError("");
    setHistory([]);
  };

  const currentInnings = match ? match.inningsData[match.innings - 1] : null;

  const swapStrike = (inn) => {
    const t = inn.striker;
    inn.striker = inn.nonStriker;
    inn.nonStriker = t;
  };

  const checkInningsEnd = (mm, inn) => {
    if (inn.wickets >= 10 || inn.balls >= mm.oversLimit * 6) {
      inn.completed = true;
      if (mm.innings === 2) computeResult(mm);
    }
    if (mm.innings === 2 && !inn.completed) {
      const target = mm.inningsData[0].runs + 1;
      if (inn.runs >= target) {
        inn.completed = true;
        computeResult(mm);
      }
    }
  };

  const computeResult = (mm) => {
    const inn1 = mm.inningsData[0];
    const inn2 = mm.inningsData[1];
    if (!inn2) return;
    const target = inn1.runs + 1;
    if (inn2.runs >= target) {
      mm.result = `${inn2.battingTeam} won by ${10 - inn2.wickets} wicket${10 - inn2.wickets === 1 ? "" : "s"}`;
    } else if (inn2.runs === target - 1) {
      mm.result = "Match tied";
    } else {
      mm.result = `${inn1.battingTeam} won by ${target - 1 - inn2.runs} run${target - 1 - inn2.runs === 1 ? "" : "s"}`;
    }
  };

  const addTicker = (inn, label, type, runs) => {
    inn.ticker.push({ label, type, runs });
    inn.thisOver.push({ label, type, runs });
  };

  // Advances ball/over counters, rotates strike, and — at the end of every
  // over — clears inn.bowler entirely so a new bowler MUST be picked; the
  // bowler who just finished cannot be reselected for the next over.
  const recordLegalBall = (mm, inn, runs, isWicket) => {
    inn.balls += 1;
    const bat = inn.batsmen[inn.striker];
    bat.balls += 1;
    const bowl = inn.bowlers[inn.bowler];
    bowl.balls += 1;
    if (!isWicket) {
      bat.runs += runs;
      bowl.runs += runs;
      inn.runs += runs;
      if (runs === 4) bat.fours += 1;
      if (runs === 6) bat.sixes += 1;
    }
    if (runs % 2 === 1 && !isWicket) swapStrike(inn);
    if (inn.balls % 6 === 0) {
      inn.thisOver = [];
      swapStrike(inn);
      inn.previousBowler = inn.bowler;
      inn.bowler = "";
    }
  };

  const doAction = (fn) => {
    if (!match || !currentInnings || currentInnings.completed || match.result) return;
    if (!currentInnings.bowler) {
      setBowlerError("Pick the bowler for this over before scoring.");
      return;
    }
    const prevMatch = match;
    const prevPlayers = players;
    const mm = deepClone(match);
    const inn = mm.inningsData[mm.innings - 1];
    const pl = deepClone(players);
    fn(mm, inn, pl);
    checkInningsEnd(mm, inn);
    pushHistory(prevMatch, prevPlayers);
    setMatch(mm);
    setPlayers(pl);
  };

  const tapRun = (n) => {
    doAction((mm, inn, pl) => {
      const sId = inn.playerIds[inn.striker];
      const bId = inn.playerIds[inn.bowler];
      recordLegalBall(mm, inn, n, false);
      if (sId) {
        pl[sId].balls += 1;
        pl[sId].runs += n;
        if (n === 4) pl[sId].fours += 1;
        if (n === 6) pl[sId].sixes += 1;
      }
      if (bId) {
        pl[bId].ballsBowled += 1;
        pl[bId].runsConceded += n;
      }
      addTicker(inn, n === 0 ? "•" : String(n), "run", n);
    });
  };

  const tapWide = (extra) => {
    doAction((mm, inn, pl) => {
      const bId = inn.playerIds[inn.bowler];
      inn.runs += 1 + extra;
      inn.extras.wd += 1 + extra;
      inn.bowlers[inn.bowler].runs += 1 + extra;
      if (bId) pl[bId].runsConceded += 1 + extra;
      addTicker(inn, extra ? `Wd+${extra}` : "Wd", "extra", 1 + extra);
      if (extra % 2 === 1) swapStrike(inn);
    });
  };

  const tapNoBall = (extra) => {
    doAction((mm, inn, pl) => {
      const sId = inn.playerIds[inn.striker];
      const bId = inn.playerIds[inn.bowler];
      inn.runs += 1 + extra;
      inn.extras.nb += 1;
      inn.bowlers[inn.bowler].runs += 1 + extra;
      if (bId) pl[bId].runsConceded += 1 + extra;
      if (extra > 0) {
        const bat = inn.batsmen[inn.striker];
        bat.runs += extra;
        bat.balls += 1;
        if (extra === 4) bat.fours += 1;
        if (extra === 6) bat.sixes += 1;
        if (sId) {
          pl[sId].balls += 1;
          pl[sId].runs += extra;
          if (extra === 4) pl[sId].fours += 1;
          if (extra === 6) pl[sId].sixes += 1;
        }
      }
      addTicker(inn, extra ? `Nb+${extra}` : "Nb", "extra", 1 + extra);
      if (extra % 2 === 1) swapStrike(inn);
    });
  };

  const tapByeLegBye = (kind, n) => {
    doAction((mm, inn, pl) => {
      const sId = inn.playerIds[inn.striker];
      const bId = inn.playerIds[inn.bowler];
      recordLegalBall(mm, inn, 0, false);
      inn.runs += n;
      inn.extras[kind] += n;
      if (sId) pl[sId].balls += 1;
      if (bId) pl[bId].ballsBowled += 1;
      addTicker(inn, `${kind === "b" ? "B" : "Lb"}${n}`, "extra", n);
      if (n % 2 === 1) swapStrike(inn);
    });
  };

  const battingTeamName = match ? (match.innings === 1 ? match.team1 : match.team2) : "";
  const bowlingTeamName = match ? (match.innings === 1 ? match.team2 : match.team1) : "";
  const battingSquad = match && match.squads ? match.squads[battingTeamName] || [] : [];
  const bowlingSquad = match && match.squads ? match.squads[bowlingTeamName] || [] : [];

  const openWicketModal = () => {
    if (!currentInnings.bowler) {
      setBowlerError("Pick the bowler for this over before scoring.");
      return;
    }
    setWicketType("Bowled");
    setNewBatsmanName("");
    setWicketModal(true);
  };

  const confirmWicket = () => {
    doAction((mm, inn, pl) => {
      const outName = inn.striker;
      const sId = inn.playerIds[outName];
      const bId = inn.playerIds[inn.bowler];
      recordLegalBall(mm, inn, 0, true);
      if (sId) pl[sId].balls += 1;
      if (bId) pl[bId].ballsBowled += 1;
      inn.batsmen[outName].out = true;
      inn.batsmen[outName].howOut = wicketType;
      inn.wickets += 1;
      if (wicketType !== "Run Out") {
        inn.bowlers[inn.bowler] && (inn.bowlers[inn.bowler].wickets += 1);
        if (bId) pl[bId].wickets += 1;
      }
      addTicker(inn, "W", "W", 0);
      if (inn.wickets < 10 && newBatsmanName) {
        const squad = (mm.squads && mm.squads[mm.innings === 1 ? mm.team1 : mm.team2]) || [];
        const nb = squad.find((p) => p.name === newBatsmanName);
        if (nb) {
          inn.playerIds[nb.name] = nb.id;
          inn.batsmen[nb.name] = inn.batsmen[nb.name] || emptyBatsman();
          if (inn.striker === outName) inn.striker = nb.name;
          else if (inn.nonStriker === outName) inn.nonStriker = nb.name;
          else inn.striker = nb.name;
          if (!inn.order.includes(nb.name)) inn.order.push(nb.name);
        }
      }
    });
    setWicketModal(false);
  };

  const confirmOpeners = () => {
    if (!openerSel.striker || !openerSel.nonStriker || !openerSel.bowler) return;
    if (openerSel.striker === openerSel.nonStriker) return;
    const mm = deepClone(match);
    const inn = mm.inningsData[mm.innings - 1];
    const bSq = (mm.squads && mm.squads[battingTeamName]) || [];
    const wSq = (mm.squads && mm.squads[bowlingTeamName]) || [];
    const sP = bSq.find((p) => p.name === openerSel.striker);
    const nsP = bSq.find((p) => p.name === openerSel.nonStriker);
    const bP = wSq.find((p) => p.name === openerSel.bowler);
    if (!sP || !nsP || !bP) return;
    inn.striker = sP.name;
    inn.nonStriker = nsP.name;
    inn.bowler = bP.name;
    inn.playerIds[sP.name] = sP.id;
    inn.playerIds[nsP.name] = nsP.id;
    inn.playerIds[bP.name] = bP.id;
    inn.batsmen[sP.name] = emptyBatsman();
    inn.batsmen[nsP.name] = emptyBatsman();
    inn.order.push(sP.name, nsP.name);
    inn.bowlers[bP.name] = emptyBowler();
    setMatch(mm);
    setOpenersPrompt(null);
  };

  const startSecondInnings = () => {
    const mm = deepClone(match);
    mm.innings = 2;
    mm.inningsData[1] = newInnings(mm.team2, mm.team1);
    setMatch(mm);
    setOpenerSel({ striker: "", nonStriker: "", bowler: "" });
    setOpenersPrompt(2);
    setHistory([]);
  };

  const endInningsEarly = () => {
    if (!currentInnings) return;
    pushHistory(match, players);
    const mm = deepClone(match);
    const inn = mm.inningsData[mm.innings - 1];
    inn.completed = true;
    if (mm.innings === 2) computeResult(mm);
    setMatch(mm);
  };

  const selectNextBowler = () => {
    if (!nextBowlerSel) return;
    const mm = deepClone(match);
    const inn = mm.inningsData[mm.innings - 1];
    if (inn.previousBowler && nextBowlerSel === inn.previousBowler) {
      setBowlerError(`${nextBowlerSel} bowled the last over — pick a different bowler.`);
      return;
    }
    const wSq = (mm.squads && mm.squads[bowlingTeamName]) || [];
    const bP = wSq.find((p) => p.name === nextBowlerSel);
    if (!bP) return;
    inn.bowler = bP.name;
    inn.playerIds[bP.name] = bP.id;
    inn.bowlers[bP.name] = inn.bowlers[bP.name] || emptyBowler();
    setBowlerError("");
    setNextBowlerSel("");
    setMatch(mm);
  };

  const swapStrikeManual = () => {
    const mm = deepClone(match);
    const inn = mm.inningsData[mm.innings - 1];
    swapStrike(inn);
    setMatch(mm);
  };

  const newMatch = async () => {
    try {
      await storage.delete(MATCH_KEY);
    } catch (e) {}
    setMatch(null);
    setHistory([]);
    setSetup({ team1: "", team2: "", overs: 20 });
    setSquadA(freshSquadRows());
    setSquadB(freshSquadRows());
    setSetupStage("teams");
    setShowScorecard(false);
  };

  const fontStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');
      .cx-root { --pitch:#EEF1F8; --pitch-2:#E3E8F5; --cream:#FFFFFF; --ink:#1E2433; --muted:#8A93A6; --leather:#12B76A; --leather-2:#0EA5A4; --gold:#F59E0B; --blue:#2E6BFF; --purple:#7C5CFC; --red:#EF4444; --offwhite:#FFFFFF; --line:#E7EAF3;
        font-family:'Inter',sans-serif; color:var(--ink); background:var(--pitch);
      }
      .cx-display { font-family:'Poppins',sans-serif; letter-spacing:0.01em; }
      .cx-mono { font-family:'JetBrains Mono',monospace; }
      .cx-panel { background:var(--cream); border:1px solid var(--line); border-radius:16px; box-shadow: 0 2px 10px rgba(30,36,51,0.05); }
      .cx-btn { font-family:'Inter',sans-serif; font-weight:600; border-radius:12px; transition:transform .08s ease, filter .08s ease, box-shadow .08s ease; cursor:pointer; }
      .cx-btn:active { transform:scale(0.94); }
      .cx-btn:disabled { opacity:0.5; cursor:not-allowed; }
      .cx-pill { border-radius:999px !important; }
      .cx-hero-wrap { background:linear-gradient(135deg, var(--leather), var(--leather-2)); border-radius:20px; box-shadow: 0 10px 28px rgba(18,183,106,0.28); position:relative; overflow:hidden; }
      .cx-hero-wrap::after { content:''; position:absolute; width:180px; height:180px; border-radius:50%; background:rgba(255,255,255,0.08); top:-60px; right:-40px; }
      .cx-score-card { background:transparent; border:none; box-shadow:none; }
      .cx-digit { display:inline-block; animation: flipin 0.35s ease; }
      @keyframes flipin { 0%{ transform: rotateX(90deg); opacity:0.3;} 100%{ transform: rotateX(0deg); opacity:1;} }
      .tok { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; font-family:'JetBrains Mono',monospace; flex:none; color:#fff; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
      .tok-0 { background:#A7AFC0; }
      .tok-r { background:var(--leather); }
      .tok-4 { background:var(--blue); }
      .tok-6 { background:var(--purple); }
      .tok-w { background:var(--red); }
      .tok-e { background:var(--gold); color:#241f19; }
      .cx-scroll::-webkit-scrollbar { height:6px; }
      .cx-scroll::-webkit-scrollbar-thumb { background:rgba(30,36,51,0.15); border-radius:3px; }
      .cx-id { font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); background:rgba(30,36,51,0.06); padding:1px 5px; border-radius:4px; margin-left:5px; }
      .cx-select { width:100%; padding:9px 10px; margin-top:4px; margin-bottom:12px; border-radius:10px; border:1px solid var(--line); font-size:14px; font-family:'Inter',sans-serif; box-sizing:border-box; background:#fff; }
      .cx-avatar { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Poppins',sans-serif; font-weight:700; font-size:12px; color:#fff; flex:none; }
      .cx-tabbar { display:flex; gap:6px; background:var(--pitch-2); border-radius:999px; padding:4px; }
      .cx-tab { flex:1; text-align:center; padding:9px 0; border-radius:999px; font-size:13px; font-weight:600; cursor:pointer; border:none; font-family:'Inter',sans-serif; display:flex; align-items:center; justify-content:center; gap:6px; }
      .cx-tab-active { background:var(--cream); color:var(--ink); box-shadow: 0 2px 6px rgba(30,36,51,0.1); }
      .cx-tab-inactive { background:transparent; color:var(--muted); }
    `}</style>
  );

  const Footer = () => (
    <div style={{ textAlign: "center", marginTop: 18, paddingTop: 12, fontSize: 11, color: "var(--muted)" }}>
      Developed by Srishivapujandar ·{" "}
      <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--leather)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
        <Instagram size={12} /> Instagram
      </a>
    </div>
  );

  if (!loaded) {
    return (
      <div className="cx-root" style={{ padding: 40, minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {fontStyle}
        <div className="cx-display" style={{ color: "var(--ink)", fontSize: 18 }}>Loading scoreboard…</div>
      </div>
    );
  }

  // ---------- SETUP: TEAMS ----------
  if (!match && setupStage === "teams") {
    return (
      <div className="cx-root" style={{ padding: 24, minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {fontStyle}
        <div className="cx-panel" style={{ padding: 28, width: "100%", maxWidth: 420 }}>
          <div className="cx-display" style={{ fontSize: 26, fontWeight: 700, marginBottom: 4, color: "var(--ink)" }}>NEW MATCH</div>
          <div style={{ fontSize: 13, color: "#6b6152", marginBottom: 6 }}>Set up teams and overs, then build each 11-player squad.</div>
          <div style={{ fontSize: 11, color: "#8a8478", marginBottom: 20, background: "rgba(0,0,0,0.04)", padding: "6px 10px", borderRadius: 6 }}>
            The live score and player stats are shared — anyone using this app can watch along.
          </div>

          <label style={labelStyle}>TEAM 1 (BATS FIRST)</label>
          <input value={setup.team1} onChange={(e) => setSetup((s) => ({ ...s, team1: e.target.value }))} placeholder="e.g. Titans" style={inputStyle} />
          <label style={labelStyle}>TEAM 2</label>
          <input value={setup.team2} onChange={(e) => setSetup((s) => ({ ...s, team2: e.target.value }))} placeholder="e.g. Warriors" style={inputStyle} />
          <label style={labelStyle}>OVERS PER INNINGS</label>
          <input type="number" min={1} value={setup.overs} onChange={(e) => setSetup((s) => ({ ...s, overs: e.target.value }))} style={inputStyle} />
          <button onClick={confirmTeams} className="cx-btn" style={{ marginTop: 4, width: "100%", padding: "12px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}>
            Next: Build {setup.team1.trim() || "Team 1"}'s Squad
          </button>
          {Object.keys(players).length > 0 && (
            <button onClick={() => setShowDirectory((s) => !s)} className="cx-btn" style={{ marginTop: 10, width: "100%", padding: "9px 0", background: "transparent", color: "var(--ink)", border: "1px solid var(--line)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Search size={13} /> Search Players {showDirectory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
        {showDirectory && <div style={{ width: "100%", maxWidth: 420, marginTop: 10 }}><PlayerDirectory players={players} /></div>}
        <div style={{ maxWidth: 420, width: "100%" }}><Footer /></div>
      </div>
    );
  }

  // ---------- SETUP: SQUAD ENTRY ----------
  if (!match && (setupStage === "squadA" || setupStage === "squadB")) {
    const isA = setupStage === "squadA";
    const teamName = isA ? setup.team1.trim() : setup.team2.trim();
    const rows = isA ? squadA : squadB;
    const setRows = isA ? setSquadA : setSquadB;
    const filledCount = rows.filter((r) => r.name.trim()).length;

    const updateRow = (i, val) => setRows((arr) => arr.map((r, idx) => (idx === i ? val : r)));

    return (
      <div className="cx-root" style={{ padding: 24, minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {fontStyle}
        <div className="cx-panel" style={{ padding: 24, width: "100%", maxWidth: 480 }}>
          <button
            onClick={() => setSetupStage(isA ? "teams" : "squadA")}
            className="cx-btn"
            style={{ background: "none", border: "none", padding: 0, marginBottom: 10, fontSize: 12, color: "#6b6152", display: "flex", alignItems: "center", gap: 4 }}
          >
            <ArrowLeft size={13} /> Back
          </button>
          <div className="cx-display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{teamName.toUpperCase()} SQUAD</div>
          <div style={{ fontSize: 12, color: "#6b6152", marginBottom: 4 }}>
            {filledCount}/{SQUAD_SIZE} players added. Search an existing player by name or ID, or type a new name to register them.
          </div>
          {squadError && <div style={{ fontSize: 12, color: "var(--leather)", marginBottom: 8, fontWeight: 600 }}>{squadError}</div>}

          <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 2, marginTop: 10 }}>
            {rows.map((row, i) => (
              <SquadPlayerRow key={i} index={i} value={row} onChange={(v) => updateRow(i, v)} players={players} />
            ))}
          </div>

          <button
            onClick={isA ? confirmSquadA : confirmSquadB}
            className="cx-btn"
            style={{ marginTop: 12, width: "100%", padding: "12px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}
          >
            {isA ? `Next: Build ${setup.team2.trim() || "Team 2"}'s Squad` : "Continue to Toss / Openers"}
          </button>
        </div>
        <div style={{ maxWidth: 480, width: "100%" }}><Footer /></div>
      </div>
    );
  }

  // ---------- OPENERS PROMPT ----------
  if (openersPrompt) {
    const inn = match.inningsData[openersPrompt - 1];
    const bSq = (match.squads && match.squads[battingTeamName]) || [];
    const wSq = (match.squads && match.squads[bowlingTeamName]) || [];
    return (
      <div className="cx-root" style={{ padding: 24, minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {fontStyle}
        <div className="cx-panel" style={{ padding: 28, width: "100%", maxWidth: 420 }}>
          <div className="cx-display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {openersPrompt === 1 ? "INNINGS 1" : "INNINGS 2"} — OPENING
          </div>
          <div style={{ fontSize: 13, color: "#6b6152", marginBottom: 18 }}>
            {inn.battingTeam} batting, {inn.bowlingTeam} bowling. Choose from each squad.
          </div>

          <label style={labelStyle}>STRIKER</label>
          <select className="cx-select" value={openerSel.striker} onChange={(e) => setOpenerSel((f) => ({ ...f, striker: e.target.value }))}>
            <option value="">Select batsman…</option>
            {bSq.map((p) => <option key={p.id} value={p.name} disabled={p.name === openerSel.nonStriker}>{p.name} ({p.role})</option>)}
          </select>

          <label style={labelStyle}>NON-STRIKER</label>
          <select className="cx-select" value={openerSel.nonStriker} onChange={(e) => setOpenerSel((f) => ({ ...f, nonStriker: e.target.value }))}>
            <option value="">Select batsman…</option>
            {bSq.map((p) => <option key={p.id} value={p.name} disabled={p.name === openerSel.striker}>{p.name} ({p.role})</option>)}
          </select>

          <label style={labelStyle}>OPENING BOWLER</label>
          <select className="cx-select" value={openerSel.bowler} onChange={(e) => setOpenerSel((f) => ({ ...f, bowler: e.target.value }))}>
            <option value="">Select bowler…</option>
            {wSq.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.role})</option>)}
          </select>

          <button onClick={confirmOpeners} className="cx-btn" style={{ marginTop: 4, width: "100%", padding: "12px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}>
            Begin Innings
          </button>
        </div>
        <div style={{ maxWidth: 420, width: "100%" }}><Footer /></div>
      </div>
    );
  }

  const inn = currentInnings;
  const crr = inn.balls > 0 ? (inn.runs / (inn.balls / 6)).toFixed(2) : "0.00";
  const target = match.innings === 2 ? match.inningsData[0].runs + 1 : null;
  const ballsLeft = match.oversLimit * 6 - inn.balls;
  const rrr = target ? (ballsLeft > 0 ? Math.max(0, (target - inn.runs) / (ballsLeft / 6)).toFixed(2) : "-") : null;
  const scoreKey = `${inn.runs}-${inn.wickets}-${inn.balls}`;
  const needsBowler = !inn.bowler && !inn.completed && !match.result;
  const availableBatsmen = battingSquad.filter(
    (p) => p.name !== inn.striker && p.name !== inn.nonStriker && !(inn.batsmen[p.name] && inn.batsmen[p.name].out)
  );
  const nextBowlerOptions = bowlingSquad.filter((p) => p.name !== inn.previousBowler);

  return (
    <div className="cx-root" style={{ padding: 16, minHeight: 480 }}>
      {fontStyle}

      {/* Hero: app bar + live score, all in one gradient card */}
      <div className="cx-hero-wrap" style={{ padding: "16px 18px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8, position: "relative", zIndex: 1 }}>
          <div className="cx-display" style={{ color: "#fff", fontSize: 15, fontWeight: 600 }}>
            {match.team1} <span style={{ opacity: 0.6 }}>vs</span> {match.team2}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: savedFlash ? "#fff" : "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", gap: 3 }}>
              <Save size={11} /> {savedFlash ? "Saved" : "Live"}
            </span>
            <button onClick={() => setShowDirectory((s) => !s)} className="cx-btn cx-pill" style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", padding: "7px 9px", fontSize: 12, display: "flex", alignItems: "center" }} title="Search players">
              <Search size={13} />
            </button>
            <button onClick={undo} disabled={history.length === 0} className="cx-btn cx-pill" style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", padding: "7px 9px", fontSize: 12, display: "flex", alignItems: "center" }} title="Undo">
              <Undo2 size={13} />
            </button>
            <button onClick={newMatch} className="cx-btn cx-pill" style={{ background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", padding: "7px 9px", fontSize: 12, display: "flex", alignItems: "center" }} title="New match">
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, position: "relative", zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginBottom: 2, letterSpacing: "0.08em", fontWeight: 600 }}>{inn.battingTeam.toUpperCase()} BATTING</div>
            <div key={scoreKey} className="cx-digit cx-display" style={{ color: "#fff", fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{inn.runs}/{inn.wickets}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="cx-mono" style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>{oversStr(inn.balls)} <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>/ {match.oversLimit} ov</span></div>
            <div className="cx-mono" style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>CRR {crr}</div>
          </div>
        </div>
        {target && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.25)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.9)", position: "relative", zIndex: 1 }} className="cx-mono">
            <span>Target {target}</span>
            <span>Need {Math.max(0, target - inn.runs)} off {Math.max(0, ballsLeft)} balls</span>
            <span>RRR {rrr}</span>
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 10, marginTop: -6 }}>Anyone using this app can see this match and player stats.</div>

      {showDirectory && <PlayerDirectory players={players} />}

      {/* Result banner */}
      {match.result && (
        <div style={{ background: "var(--gold)", color: "#fff", borderRadius: 14, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <Trophy size={20} />
          <div className="cx-display" style={{ fontWeight: 700, fontSize: 15 }}>{match.result}</div>
        </div>
      )}

      {/* Batsmen + bowler panel */}
      <div className="cx-panel" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", fontWeight: 600 }}>BATTING</div>
          <button onClick={swapStrikeManual} className="cx-btn cx-pill" style={{ background: "var(--pitch)", border: "none", padding: "4px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: 4, color: "var(--muted)" }} title="Manually swap who's on strike">
            <RefreshCw size={11} /> Swap Strike
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b6152", fontSize: 11 }}>
              <th style={{ paddingBottom: 6 }}>BATSMAN</th>
              <th style={{ paddingBottom: 6, textAlign: "right" }}>R</th>
              <th style={{ paddingBottom: 6, textAlign: "right" }}>B</th>
              <th style={{ paddingBottom: 6, textAlign: "right" }}>4s</th>
              <th style={{ paddingBottom: 6, textAlign: "right" }}>6s</th>
              <th style={{ paddingBottom: 6, textAlign: "right" }}>SR</th>
            </tr>
          </thead>
          <tbody className="cx-mono">
            {["striker", "nonStriker"].map((who) => {
              const name = inn[who];
              const b = inn.batsmen[name] || emptyBatsman();
              const id = inn.playerIds[name];
              const role = id && players[id] ? players[id].role : "Batsman";
              const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
              return (
                <tr key={who}>
                  <td style={{ padding: "5px 0", fontFamily: "Inter", fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="cx-avatar" style={{ background: avatarColor(role) }}>{initials(name) || "?"}</div>
                      <span>{name}{who === "striker" ? " *" : ""}</span>
                      {id && <span className="cx-id">{id}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>{b.runs}</td>
                  <td style={{ textAlign: "right" }}>{b.balls}</td>
                  <td style={{ textAlign: "right" }}>{b.fours}</td>
                  <td style={{ textAlign: "right" }}>{b.sixes}</td>
                  <td style={{ textAlign: "right" }}>{sr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          {inn.bowler ? (
            <div className="cx-mono" style={{ fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="cx-avatar" style={{ background: avatarColor(players[inn.playerIds[inn.bowler]]?.role || "Bowler") }}>{initials(inn.bowler) || "?"}</div>
                <div>
                  <b style={{ fontFamily: "Inter" }}>{inn.bowler}</b>
                  {inn.playerIds[inn.bowler] && <span className="cx-id">{inn.playerIds[inn.bowler]}</span>}
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{oversStr(inn.bowlers[inn.bowler]?.balls || 0)}-{inn.bowlers[inn.bowler]?.maidens || 0}-{inn.bowlers[inn.bowler]?.runs || 0}-{inn.bowlers[inn.bowler]?.wickets || 0}</div>
                </div>
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>locked till over ends</span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--leather)", marginBottom: 6 }}>
                Over complete — pick the next bowler{inn.previousBowler ? ` (not ${inn.previousBowler})` : ""}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <select className="cx-select" style={{ margin: 0, flex: 1 }} value={nextBowlerSel} onChange={(e) => setNextBowlerSel(e.target.value)}>
                  <option value="">Select bowler…</option>
                  {nextBowlerOptions.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.role})</option>)}
                </select>
                <button onClick={selectNextBowler} className="cx-btn" style={{ padding: "0 14px", background: "var(--leather)", color: "#fff", border: "none", fontSize: 13 }}>Set</button>
              </div>
              {bowlerError && <div style={{ fontSize: 11, color: "var(--leather)", marginTop: 4 }}>{bowlerError}</div>}
            </div>
          )}
        </div>
      </div>

      {/* This over ticker */}
      <div className="cx-panel" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#6b6152", marginBottom: 8, letterSpacing: "0.08em" }}>THIS OVER</div>
        <div className="cx-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {inn.thisOver.length === 0 && <span style={{ fontSize: 12, color: "#a89f8d" }}>New over — no balls yet</span>}
          {inn.thisOver.map((t, i) => <div key={i} className={tokenClass(t)}>{t.label}</div>)}
        </div>
      </div>

      {/* Scoring pad */}
      {!inn.completed && !match.result && (
        <div className="cx-panel" style={{ padding: 14, marginBottom: 12, opacity: needsBowler ? 0.5 : 1 }}>
          <div style={{ fontSize: 11, color: "#6b6152", marginBottom: 8, letterSpacing: "0.08em" }}>SCORE A BALL {needsBowler && "(pick bowler first)"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} disabled={needsBowler} onClick={() => tapRun(n)} className="cx-btn" style={{ padding: "14px 0", background: n === 4 ? "var(--blue)" : n === 6 ? "var(--purple)" : "var(--leather)", color: "#fff", border: "none", fontSize: 17 }}>{n}</button>
            ))}
            <button disabled={needsBowler} onClick={openWicketModal} className="cx-btn" style={{ padding: "14px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}>WICKET</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
            <button disabled={needsBowler} onClick={() => setExtraRunsModal("wd")} className="cx-btn" style={{ padding: "10px 0", background: "var(--gold)", color: "var(--ink)", border: "none", fontSize: 13 }}>Wide</button>
            <button disabled={needsBowler} onClick={() => setExtraRunsModal("nb")} className="cx-btn" style={{ padding: "10px 0", background: "var(--gold)", color: "var(--ink)", border: "none", fontSize: 13 }}>No Ball</button>
            <button disabled={needsBowler} onClick={() => tapByeLegBye("b", 1)} className="cx-btn" style={{ padding: "10px 0", background: "var(--gold)", color: "var(--ink)", border: "none", fontSize: 13 }}>Bye</button>
            <button disabled={needsBowler} onClick={() => tapByeLegBye("lb", 1)} className="cx-btn" style={{ padding: "10px 0", background: "var(--gold)", color: "var(--ink)", border: "none", fontSize: 13 }}>Leg Bye</button>
          </div>
        </div>
      )}

      {inn.completed && match.innings === 1 && !match.result && (
        <button onClick={startSecondInnings} className="cx-btn" style={{ width: "100%", padding: "14px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15, marginBottom: 12 }}>Start 2nd Innings</button>
      )}

      {!inn.completed && !match.result && (
        <button onClick={endInningsEarly} className="cx-btn" style={{ width: "100%", padding: "8px 0", background: "transparent", color: "var(--muted)", border: "1px solid var(--line)", fontSize: 12, marginBottom: 12 }}>End Innings Early</button>
      )}

      <div className="cx-tabbar" style={{ marginBottom: 10 }}>
        <button onClick={() => setShowScorecard((s) => !s)} className={`cx-tab ${showScorecard ? "cx-tab-active" : "cx-tab-inactive"}`}>
          Scorecard {showScorecard ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button onClick={() => setShowDirectory((s) => !s)} className={`cx-tab ${showDirectory ? "cx-tab-active" : "cx-tab-inactive"}`}>
          <Search size={13} /> Players
        </button>
      </div>

      {showScorecard && (
        <div style={{ marginBottom: 10 }}>
          {match.inningsData.map((ii, idx) => ii && (
            <div key={idx} className="cx-panel" style={{ padding: 14, marginBottom: 10 }}>
              <div className="cx-display" style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>INNINGS {idx + 1}: {ii.battingTeam} — {ii.runs}/{ii.wickets} ({oversStr(ii.balls)} ov)</div>
              <div style={{ fontSize: 11, color: "#6b6152", marginBottom: 6 }}>Extras: wd {ii.extras.wd}, nb {ii.extras.nb}, b {ii.extras.b}, lb {ii.extras.lb}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }} className="cx-mono">
                <thead>
                  <tr style={{ color: "#6b6152", textAlign: "left" }}>
                    <th style={{ paddingBottom: 4 }}>BATSMAN</th><th style={{ textAlign: "left" }}>OUT</th><th style={{ textAlign: "right" }}>R</th><th style={{ textAlign: "right" }}>B</th><th style={{ textAlign: "right" }}>4s</th><th style={{ textAlign: "right" }}>6s</th>
                  </tr>
                </thead>
                <tbody>
                  {ii.order.map((nm) => {
                    const b = ii.batsmen[nm];
                    if (!b) return null;
                    return (
                      <tr key={nm}>
                        <td style={{ fontFamily: "Inter", fontWeight: 600 }}>{nm}{ii.playerIds[nm] && <span className="cx-id">{ii.playerIds[nm]}</span>}</td>
                        <td style={{ color: "#8a8478" }}>{b.out ? b.howOut : "not out"}</td>
                        <td style={{ textAlign: "right" }}>{b.runs}</td><td style={{ textAlign: "right" }}>{b.balls}</td><td style={{ textAlign: "right" }}>{b.fours}</td><td style={{ textAlign: "right" }}>{b.sixes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }} className="cx-mono">
                <thead>
                  <tr style={{ color: "#6b6152", textAlign: "left" }}><th style={{ paddingBottom: 4 }}>BOWLER</th><th style={{ textAlign: "right" }}>O</th><th style={{ textAlign: "right" }}>R</th><th style={{ textAlign: "right" }}>W</th><th style={{ textAlign: "right" }}>ECO</th></tr>
                </thead>
                <tbody>
                  {Object.keys(ii.bowlers).map((nm) => {
                    const b = ii.bowlers[nm];
                    const eco = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(2) : "0.00";
                    return (
                      <tr key={nm}>
                        <td style={{ fontFamily: "Inter", fontWeight: 600 }}>{nm}{ii.playerIds[nm] && <span className="cx-id">{ii.playerIds[nm]}</span>}</td>
                        <td style={{ textAlign: "right" }}>{oversStr(b.balls)}</td><td style={{ textAlign: "right" }}>{b.runs}</td><td style={{ textAlign: "right" }}>{b.wickets}</td><td style={{ textAlign: "right" }}>{eco}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Wicket modal */}
      {wicketModal && (
        <Modal onClose={() => setWicketModal(false)}>
          <div className="cx-display" style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>WICKET</div>
          <label style={labelStyle}>HOW OUT</label>
          <select className="cx-select" value={wicketType} onChange={(e) => setWicketType(e.target.value)}>
            {WICKET_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <label style={labelStyle}>NEW BATSMAN {inn.wickets >= 9 ? "(last wicket — optional)" : ""}</label>
          <select className="cx-select" value={newBatsmanName} onChange={(e) => setNewBatsmanName(e.target.value)}>
            <option value="">Select next batsman…</option>
            {availableBatsmen.map((p) => <option key={p.id} value={p.name}>{p.name} ({p.role}) — {p.id}</option>)}
          </select>
          <button onClick={confirmWicket} className="cx-btn" style={{ marginTop: 8, width: "100%", padding: "12px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}>Confirm Wicket</button>
        </Modal>
      )}

      {/* Wide / No ball extra runs modal */}
      {extraRunsModal && (
        <Modal onClose={() => setExtraRunsModal(null)}>
          <div className="cx-display" style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{extraRunsModal === "wd" ? "WIDE" : "NO BALL"} — extra runs taken?</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} onClick={() => { extraRunsModal === "wd" ? tapWide(n) : tapNoBall(n); setExtraRunsModal(null); }} className="cx-btn" style={{ padding: "12px 0", background: "var(--leather)", color: "#fff", border: "none", fontSize: 15 }}>{n}</button>
            ))}
          </div>
        </Modal>
      )}

      <Footer />
    </div>
  );
}

// One squad slot: search an existing player by name/ID, or type a fresh name
// (with a role) to register a brand-new player when the squad is finalized.
function SquadPlayerRow({ index, value, onChange, players }) {
  const [query, setQuery] = useState(value.name || "");
  const [showSuggest, setShowSuggest] = useState(false);

  const suggestions =
    !value.id && query.trim().length > 0
      ? Object.values(players)
          .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.id.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 5)
      : [];

  const pickExisting = (p) => {
    onChange({ id: p.id, name: p.name, role: p.role });
    setQuery(p.name);
    setShowSuggest(false);
  };

  const clearSelection = () => {
    onChange({ id: null, name: "", role: "Batsman" });
    setQuery("");
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, position: "relative" }}>
      <span style={{ fontSize: 11, color: "#8a8478", width: 16, flex: "none" }}>{index + 1}</span>
      {value.id ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.05)", borderRadius: 7, padding: "8px 10px" }}>
          <div style={{ fontSize: 13 }}>
            <b>{value.name}</b>
            <span className="cx-id">{value.id}</span>
            <span style={{ fontSize: 11, color: "#8a8478", marginLeft: 6 }}>{value.role} · existing player</span>
          </div>
          <button type="button" onClick={clearSelection} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8478" }}><X size={14} /></button>
        </div>
      ) : (
        <>
          <div style={{ position: "relative", flex: 2 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 11, color: "#8a8478", pointerEvents: "none" }} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); onChange({ ...value, id: null, name: e.target.value }); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="Search or type new player name"
              style={{ width: "100%", padding: "8px 10px 8px 28px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 13, boxSizing: "border-box" }}
            />
            {showSuggest && suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 7, zIndex: 20, marginTop: 2, maxHeight: 160, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                {suggestions.map((p) => (
                  <div key={p.id} onMouseDown={() => pickExisting(p)} style={{ padding: "7px 10px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
                    <b>{p.name}</b><span className="cx-id">{p.id}</span> · {p.role} · {p.runs} runs
                  </div>
                ))}
              </div>
            )}
          </div>
          <select value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value })} style={{ flex: 1, padding: "8px 4px", borderRadius: 7, border: "1px solid var(--line)", fontSize: 12 }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

function PlayerDirectory({ players }) {
  const [q, setQ] = useState("");
  const filtered = Object.values(players).filter(
    (p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.id.toLowerCase().includes(q.trim().toLowerCase())
  );
  const list = filtered.sort((a, b) => b.runs - a.runs);
  return (
    <div className="cx-panel" style={{ padding: 14, marginBottom: 10 }}>
      <div className="cx-display" style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>PLAYER SEARCH & HISTORY</div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={14} style={{ position: "absolute", left: 9, top: 11, color: "#8a8478" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or player ID…" style={{ ...inputStyle, margin: 0, paddingLeft: 30 }} />
      </div>
      {list.length === 0 && <div style={{ fontSize: 12, color: "#8a8478" }}>No players found.</div>}
      {list.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }} className="cx-mono">
            <thead>
              <tr style={{ color: "#6b6152", textAlign: "left" }}>
                <th style={{ paddingBottom: 4 }}>ID</th><th style={{ textAlign: "left" }}>NAME</th><th style={{ textAlign: "left" }}>ROLE</th>
                <th style={{ textAlign: "right" }}>M</th><th style={{ textAlign: "right" }}>RUNS</th><th style={{ textAlign: "right" }}>SR</th>
                <th style={{ textAlign: "right" }}>OV</th><th style={{ textAlign: "right" }}>WKT</th><th style={{ textAlign: "right" }}>ECO</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(1) : "-";
                const bowls = p.role === "Bowler" || p.role === "All-rounder";
                const eco = bowls && p.ballsBowled > 0 ? (p.runsConceded / (p.ballsBowled / 6)).toFixed(2) : "-";
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td style={{ fontFamily: "Inter", fontWeight: 600 }}>{p.name}</td>
                    <td>{p.role}</td>
                    <td style={{ textAlign: "right" }}>{p.matches}</td>
                    <td style={{ textAlign: "right" }}>{p.runs}</td>
                    <td style={{ textAlign: "right" }}>{sr}</td>
                    <td style={{ textAlign: "right" }}>{bowls ? oversStr(p.ballsBowled) : "-"}</td>
                    <td style={{ textAlign: "right" }}>{bowls ? p.wickets : "-"}</td>
                    <td style={{ textAlign: "right" }}>{eco}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div className="cx-panel" style={{ padding: 24, width: "100%", maxWidth: 380, position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "#6b6152" }}><X size={18} /></button>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 10px", marginTop: 4, marginBottom: 12, borderRadius: 7,
  border: "1px solid #d8cfb6", fontSize: 14, fontFamily: "Inter, sans-serif", boxSizing: "border-box",
};

const labelStyle = { fontSize: 12, fontWeight: 600, color: "#6b6152" };
