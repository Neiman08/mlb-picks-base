import { Router } from 'express';
import { getScheduleByDate, getTeamHittingStats, getPitcherStats } from '../services/mlbService.js';
import { getMlbOdds } from '../services/oddsService.js';
import { buildGameAnalysis } from '../utils/scoring.js';

const router = Router();

router.get('/games', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const schedule = await getScheduleByDate(date);
    const odds = await getMlbOdds();

    const games = schedule.map((game) => ({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status?.detailedState,
      awayTeam: game.teams.away.team.name,
      homeTeam: game.teams.home.team.name,
      awayProbablePitcher: game.teams.away.probablePitcher?.fullName || null,
      homeProbablePitcher: game.teams.home.probablePitcher?.fullName || null,
      odds: odds.find((item) => item.home_team === game.teams.home.team.name && item.away_team === game.teams.away.team.name) || null
    }));

    res.json({ ok: true, date, count: games.length, games });
  } catch (error) {
    next(error);
  }
});

router.get('/analyze/:gamePk', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const gamePk = Number(req.params.gamePk);
    const schedule = await getScheduleByDate(date);
    const game = schedule.find((item) => item.gamePk === gamePk);

    if (!game) {
      return res.status(404).json({ ok: false, error: 'Game not found for provided date' });
    }

    const awayTeamId = game.teams.away.team.id;
    const homeTeamId = game.teams.home.team.id;
    const awayPitcherId = game.teams.away.probablePitcher?.id;
    const homePitcherId = game.teams.home.probablePitcher?.id;

    const [awayHitting, homeHitting, awayPitcher, homePitcher, odds] = await Promise.all([
      getTeamHittingStats(awayTeamId),
      getTeamHittingStats(homeTeamId),
      awayPitcherId ? getPitcherStats(awayPitcherId) : null,
      homePitcherId ? getPitcherStats(homePitcherId) : null,
      getMlbOdds()
    ]);

    const gameOdds = odds.find((item) => item.home_team === game.teams.home.team.name && item.away_team === game.teams.away.team.name) || null;

    const analysis = buildGameAnalysis({
      game,
      awayHitting,
      homeHitting,
      awayPitcher,
      homePitcher,
      odds: gameOdds
    });

    res.json({ ok: true, date, analysis });
  } catch (error) {
    next(error);
  }
});

export default router;
