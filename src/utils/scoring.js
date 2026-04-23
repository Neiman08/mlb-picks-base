function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function normalizeInverse(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return 50;
  if (max === min) return 50;
  const normalized = ((max - value) / (max - min)) * 100;
  return clamp(normalized);
}

function normalizeDirect(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return 50;
  if (max === min) return 50;
  const normalized = ((value - min) / (max - min)) * 100;
  return clamp(normalized);
}

function americanOddsToImpliedProb(americanOdds) {
  if (americanOdds === null || americanOdds === undefined) return null;

  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  }

  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function calcPitcherScore(pitcher) {
  if (!pitcher) return 50;

  const eraScore = normalizeInverse(pitcher.era, 2.0, 7.0);
  const whipScore = normalizeInverse(pitcher.whip, 0.9, 1.8);

  const innings = pitcher.inningsPitched || 0;
  const k9 = innings > 0 ? (pitcher.strikeOuts / innings) * 9 : null;
  const bb9 = innings > 0 ? (pitcher.baseOnBalls / innings) * 9 : null;

  const k9Score = normalizeDirect(k9, 5, 13);
  const bb9Score = normalizeInverse(bb9, 1, 5);

  const samplePenalty = pitcher.gamesStarted && pitcher.gamesStarted < 3 ? -4 : 0;

  return clamp(
    (eraScore * 0.35) +
    (whipScore * 0.30) +
    (k9Score * 0.20) +
    (bb9Score * 0.15) +
    samplePenalty
  );
}

function calcOffenseScore(team) {
  if (!team) return 50;

  const runsPerGame = team.gamesPlayed > 0 ? team.runs / team.gamesPlayed : null;

  const avgScore = normalizeDirect(team.avg, 0.210, 0.290);
  const obpScore = normalizeDirect(team.obp, 0.280, 0.380);
  const slgScore = normalizeDirect(team.slg, 0.340, 0.520);
  const opsScore = normalizeDirect(team.ops, 0.620, 0.900);
  const rpgScore = normalizeDirect(runsPerGame, 3.0, 6.5);

  return clamp(
    (opsScore * 0.30) +
    (obpScore * 0.20) +
    (slgScore * 0.20) +
    (rpgScore * 0.20) +
    (avgScore * 0.10)
  );
}

function extractBestMoneyline(odds, teamName) {
  if (!odds?.bookmakers?.length) return null;

  const prices = [];

  for (const bookmaker of odds.bookmakers) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'h2h') continue;

      for (const outcome of market.outcomes || []) {
        if (outcome.name === teamName && typeof outcome.price === 'number') {
          prices.push(outcome.price);
        }
      }
    }
  }

  if (!prices.length) return null;

  const positive = prices.filter((p) => p > 0);
  if (positive.length) return Math.max(...positive);

  return Math.max(...prices);
}

function calcValueScore(modelWinProb, americanOdds) {
  const impliedProb = americanOddsToImpliedProb(americanOdds);

  if (impliedProb === null) {
    return {
      impliedProb: null,
      edge: null,
      valueScore: 50
    };
  }

  const edge = modelWinProb - impliedProb;

  return {
    impliedProb,
    edge,
    valueScore: clamp(50 + (edge * 180))
  };
}

function getConfidence({ winPctDiff, pickedEdge, pickedPitcherScore, pickedOffenseScore }) {
  let points = 0;

  if (winPctDiff >= 12) points += 2;
  else if (winPctDiff >= 7) points += 1;

  if (pickedEdge !== null) {
    if (pickedEdge >= 0.05) points += 2;
    else if (pickedEdge >= 0.02) points += 1;
  }

  if (pickedPitcherScore >= 65) points += 1;
  if (pickedOffenseScore >= 60) points += 1;

  if (points >= 5) return 'alta';
  if (points >= 3) return 'media';
  return 'baja';
}

function buildNotes({
  awayTeamName,
  homeTeamName,
  awayPitcherScore,
  homePitcherScore,
  awayOffenseScore,
  homeOffenseScore,
  awayEdge,
  homeEdge
}) {
  const notes = [];

  const pitcherDiff = awayPitcherScore - homePitcherScore;
  const offenseDiff = awayOffenseScore - homeOffenseScore;

  if (pitcherDiff >= 8) {
    notes.push(`Ventaja clara en abridor para ${awayTeamName}.`);
  } else if (pitcherDiff <= -8) {
    notes.push(`Ventaja clara en abridor para ${homeTeamName}.`);
  } else {
    notes.push('Diferencia moderada en abridores.');
  }

  if (offenseDiff >= 7) {
    notes.push(`La ofensiva de ${awayTeamName} llega mejor perfilada.`);
  } else if (offenseDiff <= -7) {
    notes.push(`La ofensiva de ${homeTeamName} llega mejor perfilada.`);
  } else {
    notes.push('Las ofensivas lucen relativamente parejas.');
  }

  if (awayEdge !== null || homeEdge !== null) {
    if ((awayEdge ?? -999) > 0.03) {
      notes.push(`El modelo detecta valor en la línea de ${awayTeamName}.`);
    }
    if ((homeEdge ?? -999) > 0.03) {
      notes.push(`El modelo detecta valor en la línea de ${homeTeamName}.`);
    }
  } else {
    notes.push('No hay línea disponible; el análisis usa solo datos deportivos.');
  }

  return notes;
}

function projectRunMargin(homeFinalScore, awayFinalScore) {
  const diff = homeFinalScore - awayFinalScore;
  const rawMargin = diff / 8;
  return Math.max(-4.5, Math.min(4.5, rawMargin));
}

function buildRunLinePick(projectedMargin, homeTeamName, awayTeamName) {
  const favoredTeam = projectedMargin > 0 ? homeTeamName : awayTeamName;
  const dogTeam = projectedMargin > 0 ? awayTeamName : homeTeamName;
  const absMargin = Math.abs(projectedMargin);

  let pick;
  let coverProb;
  let confidence;

  if (absMargin >= 1.8) {
    pick = `${favoredTeam} -1.5`;
    coverProb = clamp(50 + ((absMargin - 1.5) * 18), 50, 72);
    confidence = absMargin >= 2.4 ? 'alta' : 'media';
  } else {
    pick = `${dogTeam} +1.5`;
    coverProb = clamp(56 + ((1.8 - absMargin) * 10), 56, 74);
    confidence = absMargin <= 0.8 ? 'alta' : 'media';
  }

  return {
    pick,
    projectedMargin: round(projectedMargin),
    coverProb: round(coverProb),
    confidence
  };
}

function projectTeamRuns({ teamOffenseScore, opponentPitcherScore, isHomeTeam }) {
  let runs = 4.35;

  runs += (teamOffenseScore - 50) * 0.045;
  runs -= (opponentPitcherScore - 50) * 0.04;

  if (isHomeTeam) runs += 0.12;

  return Math.max(2.2, Math.min(7.8, runs));
}

function buildTeamTotalPick(teamName, projectedRuns) {
  const line = Math.round((projectedRuns - 0.5) * 2) / 2;
  const diff = projectedRuns - line;
  const isOver = diff >= 0;
  const pick = `${teamName} ${isOver ? 'over' : 'under'} ${line.toFixed(1)}`;
  const prob = clamp(50 + Math.abs(diff) * 22, 50, 68);

  let confidence = 'baja';
  if (prob >= 61) confidence = 'alta';
  else if (prob >= 55) confidence = 'media';

  return {
    pick,
    line: round(line, 1),
    projectedRuns: round(projectedRuns),
    probability: round(prob),
    confidence
  };
}

export function buildGameAnalysis({ game, awayHitting, homeHitting, awayPitcher, homePitcher, odds }) {
  const awayTeamName = game.teams.away.team.name;
  const homeTeamName = game.teams.home.team.name;

  const awayPitcherScore = calcPitcherScore(awayPitcher);
  const homePitcherScore = calcPitcherScore(homePitcher);

  const awayOffenseScore = calcOffenseScore(awayHitting);
  const homeOffenseScore = calcOffenseScore(homeHitting);

  const awayBaseScore =
    (awayPitcherScore * 0.58) +
    (awayOffenseScore * 0.42);

  const homeBaseScore =
    (homePitcherScore * 0.58) +
    (homeOffenseScore * 0.42) +
    2.5;

  const totalBase = awayBaseScore + homeBaseScore;

  const awayModelWinProb = totalBase > 0 ? awayBaseScore / totalBase : 0.5;
  const homeModelWinProb = totalBase > 0 ? homeBaseScore / totalBase : 0.5;

  const awayMoneyline = extractBestMoneyline(odds, awayTeamName);
  const homeMoneyline = extractBestMoneyline(odds, homeTeamName);

  const awayValue = calcValueScore(awayModelWinProb, awayMoneyline);
  const homeValue = calcValueScore(homeModelWinProb, homeMoneyline);

  const awayFinalScore =
    (awayBaseScore * 0.88) +
    (awayValue.valueScore * 0.12);

  const homeFinalScore =
    (homeBaseScore * 0.88) +
    (homeValue.valueScore * 0.12);

  const pickIsAway = awayFinalScore > homeFinalScore;
  const pick = pickIsAway ? awayTeamName : homeTeamName;

  const awayModelWinPct = awayModelWinProb * 100;
  const homeModelWinPct = homeModelWinProb * 100;
  const winPctDiff = Math.abs(awayModelWinPct - homeModelWinPct);

  const pickedEdge = pickIsAway ? awayValue.edge : homeValue.edge;
  const pickedPitcherScore = pickIsAway ? awayPitcherScore : homePitcherScore;
  const pickedOffenseScore = pickIsAway ? awayOffenseScore : homeOffenseScore;

  const confidence = getConfidence({
    winPctDiff,
    pickedEdge,
    pickedPitcherScore,
    pickedOffenseScore
  });

  const notes = buildNotes({
    awayTeamName,
    homeTeamName,
    awayPitcherScore,
    homePitcherScore,
    awayOffenseScore,
    homeOffenseScore,
    awayEdge: awayValue.edge,
    homeEdge: homeValue.edge
  });

  const projectedMargin = projectRunMargin(homeFinalScore, awayFinalScore);
  const runLine = buildRunLinePick(projectedMargin, homeTeamName, awayTeamName);

  const awayProjectedRuns = projectTeamRuns({
    teamOffenseScore: awayOffenseScore,
    opponentPitcherScore: homePitcherScore,
    isHomeTeam: false
  });

  const homeProjectedRuns = projectTeamRuns({
    teamOffenseScore: homeOffenseScore,
    opponentPitcherScore: awayPitcherScore,
    isHomeTeam: true
  });

  const awayTeamTotal = buildTeamTotalPick(awayTeamName, awayProjectedRuns);
  const homeTeamTotal = buildTeamTotalPick(homeTeamName, homeProjectedRuns);

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    matchup: `${awayTeamName} vs ${homeTeamName}`,
    pick,
    confidence,
    away: {
      team: awayTeamName,
      probablePitcher: game.teams.away.probablePitcher?.fullName || null,
      pitcherScore: round(awayPitcherScore),
      offenseScore: round(awayOffenseScore),
      baseScore: round(awayBaseScore),
      impliedProb: awayValue.impliedProb !== null ? round(awayValue.impliedProb * 100) : null,
      edge: awayValue.edge !== null ? round(awayValue.edge * 100) : null,
      oddsValueScore: round(awayValue.valueScore),
      finalScore: round(awayFinalScore),
      modelWinPct: round(awayModelWinPct),
      moneyline: awayMoneyline
    },
    home: {
      team: homeTeamName,
      probablePitcher: game.teams.home.probablePitcher?.fullName || null,
      pitcherScore: round(homePitcherScore),
      offenseScore: round(homeOffenseScore),
      baseScore: round(homeBaseScore),
      impliedProb: homeValue.impliedProb !== null ? round(homeValue.impliedProb * 100) : null,
      edge: homeValue.edge !== null ? round(homeValue.edge * 100) : null,
      oddsValueScore: round(homeValue.valueScore),
      finalScore: round(homeFinalScore),
      modelWinPct: round(homeModelWinPct),
      moneyline: homeMoneyline
    },
    runLine,
    teamTotals: {
      away: awayTeamTotal,
      home: homeTeamTotal,
      combinedProjectedTotal: round(awayProjectedRuns + homeProjectedRuns)
    },
    notes
  };
}