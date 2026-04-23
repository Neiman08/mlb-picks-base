function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeInverse(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return 50;
  const normalized = ((max - value) / (max - min)) * 100;
  return clamp(normalized);
}

function normalizeDirect(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return 50;
  const normalized = ((value - min) / (max - min)) * 100;
  return clamp(normalized);
}

function calcPitcherScore(pitcher) {
  if (!pitcher) return 50;

  const eraScore = normalizeInverse(pitcher.era, 2, 7);
  const whipScore = normalizeInverse(pitcher.whip, 0.9, 1.8);
  const k9 = pitcher.inningsPitched > 0 ? (pitcher.strikeOuts / pitcher.inningsPitched) * 9 : 0;
  const bb9 = pitcher.inningsPitched > 0 ? (pitcher.baseOnBalls / pitcher.inningsPitched) * 9 : 0;
  const k9Score = normalizeDirect(k9, 5, 13);
  const bb9Score = normalizeInverse(bb9, 1, 5);

  return clamp((eraScore * 0.35) + (whipScore * 0.30) + (k9Score * 0.20) + (bb9Score * 0.15));
}

function calcOffenseScore(team) {
  if (!team) return 50;

  const runsPerGame = team.gamesPlayed > 0 ? team.runs / team.gamesPlayed : 0;
  const opsScore = normalizeDirect(team.ops, 0.62, 0.9);
  const obpScore = normalizeDirect(team.obp, 0.28, 0.38);
  const slgScore = normalizeDirect(team.slg, 0.34, 0.52);
  const rpgScore = normalizeDirect(runsPerGame, 3, 6.5);

  return clamp((opsScore * 0.40) + (obpScore * 0.20) + (slgScore * 0.20) + (rpgScore * 0.20));
}

function calcOddsValueScore(modelWinPct, americanOdds) {
  if (!americanOdds) return 50;

  const impliedProb = americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);

  const edge = modelWinPct - impliedProb;
  return clamp(50 + (edge * 200));
}

function extractBestMoneyline(odds, teamName) {
  if (!odds?.bookmakers?.length) return null;

  const prices = [];
  for (const bookmaker of odds.bookmakers) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'h2h') continue;
      for (const outcome of market.outcomes || []) {
        if (outcome.name === teamName) prices.push(outcome.price);
      }
    }
  }

  if (!prices.length) return null;

  const positive = prices.filter((p) => p > 0);
  if (positive.length) return Math.max(...positive);
  return Math.max(...prices);
}

export function buildGameAnalysis({ game, awayHitting, homeHitting, awayPitcher, homePitcher, odds }) {
  const awayPitcherScore = calcPitcherScore(awayPitcher);
  const homePitcherScore = calcPitcherScore(homePitcher);
  const awayOffenseScore = calcOffenseScore(awayHitting);
  const homeOffenseScore = calcOffenseScore(homeHitting);

  const awayBaseScore = (awayPitcherScore * 0.55) + (awayOffenseScore * 0.35) + 5;
  const homeBaseScore = (homePitcherScore * 0.55) + (homeOffenseScore * 0.35) + 10;

  const total = awayBaseScore + homeBaseScore;
  const awayModelWinPct = total > 0 ? awayBaseScore / total : 0.5;
  const homeModelWinPct = total > 0 ? homeBaseScore / total : 0.5;

  const awayMoneyline = extractBestMoneyline(odds, game.teams.away.team.name);
  const homeMoneyline = extractBestMoneyline(odds, game.teams.home.team.name);

  const awayOddsValue = calcOddsValueScore(awayModelWinPct, awayMoneyline);
  const homeOddsValue = calcOddsValueScore(homeModelWinPct, homeMoneyline);

  const awayFinal = clamp((awayBaseScore * 0.85) + (awayOddsValue * 0.15));
  const homeFinal = clamp((homeBaseScore * 0.85) + (homeOddsValue * 0.15));

  const pick = awayFinal > homeFinal ? game.teams.away.team.name : game.teams.home.team.name;
  const edge = Math.abs(awayFinal - homeFinal);
  const confidence = edge >= 12 ? 'alta' : edge >= 6 ? 'media' : 'baja';

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    matchup: `${game.teams.away.team.name} vs ${game.teams.home.team.name}`,
    pick,
    confidence,
    away: {
      team: game.teams.away.team.name,
      probablePitcher: game.teams.away.probablePitcher?.fullName || null,
      pitcherScore: Number(awayPitcherScore.toFixed(2)),
      offenseScore: Number(awayOffenseScore.toFixed(2)),
      oddsValueScore: Number(awayOddsValue.toFixed(2)),
      finalScore: Number(awayFinal.toFixed(2)),
      modelWinPct: Number((awayModelWinPct * 100).toFixed(2)),
      moneyline: awayMoneyline
    },
    home: {
      team: game.teams.home.team.name,
      probablePitcher: game.teams.home.probablePitcher?.fullName || null,
      pitcherScore: Number(homePitcherScore.toFixed(2)),
      offenseScore: Number(homeOffenseScore.toFixed(2)),
      oddsValueScore: Number(homeOddsValue.toFixed(2)),
      finalScore: Number(homeFinal.toFixed(2)),
      modelWinPct: Number((homeModelWinPct * 100).toFixed(2)),
      moneyline: homeMoneyline
    },
    notes: [
      'Esta versión del modelo pondera pitcher y ofensiva más que bullpen.',
      'El score de valor sube cuando la probabilidad del modelo supera la probabilidad implícita de la línea.',
      'La ventaja local está incluida en el score base del equipo home.'
    ]
  };
}
