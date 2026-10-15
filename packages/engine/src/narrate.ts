import type { Translate } from '@rollionaire/boards';
import { boardOf, type BaseState, findPlayer } from './helpers';
import type { GameEvent } from './types';

/**
 * One plain sentence per event, for the game log and the screen-reader live
 * region (PRD 11.4). Returns null for events that are animation-only.
 */
export function narrate(ev: GameEvent, s: BaseState, t: Translate): string | null {
  const board = boardOf(s);
  const name = (id: string | null) => (id ? (findPlayer(s, id)?.name ?? id) : t('bank'));
  const tile = (i: number) => t(board.tiles[i]!.key);
  switch (ev.t) {
    case 'GameStarted':
      return t('ev.GameStarted');
    case 'FreePropertyDealt':
      return t('ev.FreePropertyDealt', { player: name(ev.playerId), tile: tile(ev.tile) });
    case 'TurnStarted':
      return t('ev.TurnStarted', { player: name(ev.playerId) });
    case 'DiceRolled': {
      const [d1, d2] = ev.dice;
      return t(d1 === d2 ? 'ev.DiceRolled.doubles' : 'ev.DiceRolled', { player: name(ev.playerId), d1, d2 });
    }
    case 'TokenMoved':
      return t('ev.TokenMoved', { player: name(ev.playerId), tile: tile(ev.to) });
    case 'PassedStart':
      return t(ev.exact ? 'ev.PassedStart.exact' : 'ev.PassedStart', { player: name(ev.playerId), amount: ev.amount });
    case 'PropertyBought':
      return t('ev.PropertyBought', { player: name(ev.playerId), tile: tile(ev.tile), amount: ev.price });
    case 'BuyDeclined':
      return t('ev.BuyDeclined', { player: name(ev.playerId), tile: tile(ev.tile) });
    case 'AuctionStarted':
      return t('ev.AuctionStarted', { tile: tile(ev.tile) });
    case 'BidPlaced':
      return t('ev.BidPlaced', { player: name(ev.playerId), amount: ev.amount });
    case 'AuctionPassed':
      return t('ev.AuctionPassed', { player: name(ev.playerId) });
    case 'AuctionWon':
      return t('ev.AuctionWon', { player: name(ev.playerId), tile: tile(ev.tile), amount: ev.amount });
    case 'AuctionUnsold':
      return t('ev.AuctionUnsold', { tile: tile(ev.tile) });
    case 'CardDrawn':
      return t('ev.CardDrawn', {
        player: name(ev.playerId),
        deck: t(`deck.${ev.deck}`),
        card: t(`${ev.key}.title`),
      });
    case 'RentPaid':
      return t('ev.RentPaid', { from: name(ev.from), to: name(ev.to), amount: ev.amount, tile: tile(ev.tile) });
    case 'Paid':
      if (ev.reason === 'mortgageFee') return t('ev.Paid.mortgageFee', { from: name(ev.from), amount: ev.amount });
      return t('ev.Paid', { from: name(ev.from), to: ev.toJackpot ? t('jackpot') : name(ev.to), amount: ev.amount });
    case 'Collected':
      return t('ev.Collected', { player: name(ev.playerId), amount: ev.amount });
    case 'JackpotWon':
      return t('ev.JackpotWon', { player: name(ev.playerId), amount: ev.amount });
    case 'BuildingBuilt':
      return t(ev.level === s.settings.housesForHotel + 1 ? 'ev.BuildingBuilt.hotel' : 'ev.BuildingBuilt', {
        player: name(ev.playerId),
        tile: tile(ev.tile),
      });
    case 'BuildingSold':
      return t('ev.BuildingSold', { player: name(ev.playerId), tile: tile(ev.tile), amount: ev.refund });
    case 'Mortgaged':
      return t('ev.Mortgaged', { player: name(ev.playerId), tile: tile(ev.tile), amount: ev.amount });
    case 'Unmortgaged':
      return t('ev.Unmortgaged', { player: name(ev.playerId), tile: tile(ev.tile), amount: ev.cost });
    case 'WentToJail':
      return t(ev.reason === 'doubles' ? 'ev.WentToJail.doubles' : 'ev.WentToJail', { player: name(ev.playerId) });
    case 'LeftJail':
      return t('ev.LeftJail', { player: name(ev.playerId) });
    case 'JailRollFailed':
      return t('ev.JailRollFailed', { player: name(ev.playerId), attempt: ev.attempt });
    case 'BailPassGained':
      return t('ev.BailPassGained', { player: name(ev.playerId) });
    case 'DebtStarted':
      return t('ev.DebtStarted', { player: name(ev.debtorId), amount: ev.amount });
    case 'TradeProposed':
      return t('ev.TradeProposed', { from: name(ev.trade.fromId), to: name(ev.trade.toId) });
    case 'TradeCountered':
      return t('ev.TradeCountered', { player: name(ev.by) });
    case 'TradeCompleted':
      return t('ev.TradeCompleted', { from: name(ev.trade.fromId), to: name(ev.trade.toId) });
    case 'TradeDeclined':
      return t('ev.TradeDeclined', { player: name(ev.by) });
    case 'TradeCancelled':
      return t('ev.TradeCancelled', { player: name(ev.by) });
    case 'TradeExpired':
      return t('ev.TradeExpired');
    case 'TradeVoided':
      return t('ev.TradeVoided');
    case 'Bankrupt':
      return t('ev.Bankrupt', { player: name(ev.playerId) });
    case 'PlayerAway':
      return t('ev.PlayerAway', { player: name(ev.playerId) });
    case 'PlayerBack':
      return t('ev.PlayerBack', { player: name(ev.playerId) });
    case 'TimedOut':
      return ev.playerId ? t('ev.TimedOut', { player: name(ev.playerId) }) : t('ev.TimedOut.auction');
    case 'TurnEnded':
      return null;
    case 'GameOver':
      return t(ev.winnerIds.length > 1 ? 'ev.GameOver.tie' : 'ev.GameOver', {
        player: ev.winnerIds.map((id) => name(id)).join(', '),
      });
  }
}
