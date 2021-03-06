'use strict'
const { logIgnoredMatch, getPlayerAlias } = require('./utils')

const getRankingPlaceByPlayerId = (userId, ranking) => {
    for (let idx = 0; idx < ranking.length; idx++) {
        const people = ranking[idx]
        if (people.includes(userId)) {
            return idx + 1
        }
    }

    return ranking.length + 1// Means unranked
}

const doesPlayerAAlreadyWonAgainstThatPlace = (playerAId, completedChallenges, place, ranking) => completedChallenges.find(
    match => 
        match.winner === playerAId && 
        place === getRankingPlaceByPlayerId(match.player1 === playerAId ? match.player2 : match.player1, ranking)
)

const doesPlayerChallengedAlreadyWonAgainstThatChallenger = (playerChallengedId, challengersCompletedChallenges) => challengersCompletedChallenges.find(
    match => match.winner === playerChallengedId
)

const identifyPlayers = (playerAId, playerBId, rankingTable) => {
    const playerAPlace = getRankingPlaceByPlayerId(playerAId, rankingTable)
    const playerBPlace = getRankingPlaceByPlayerId(playerBId, rankingTable)

    if (playerAPlace > playerBPlace) {// playerA is below playerB in ranking
        return {
            challengerId: playerAId,
            challengerPlace: playerAPlace,
            playerChallengedId: playerBId,
            playerChallengedPlace: playerBPlace
        }
    }

    return {
        challengerId: playerBId,
        challengerPlace: playerBPlace,
        playerChallengedId: playerAId,
        playerChallengedPlace: playerAPlace
    }
}

const getUnrankedPlayerScore = playerPlace => {
    const initialCoins = getInitialCoinsForPlayer(playerPlace)
    return {
        stand_points: 0, points: 0,
        initial_coins: initialCoins, coins: initialCoins, range: initialCoins,
        completed_challenges: []
    }
}

const isReportedResultValid = (identifiedPlayersObj, rankingTable, playerScoreboard, reportedResult) => {

    const {
        challengerId, challengerPlace,
        playerChallengedId, playerChallengedPlace
    } = identifiedPlayersObj

    if (challengerPlace === playerChallengedPlace) {// They cannot challenge people in the same place
        logIgnoredMatch(`Ignored result between players "${getPlayerAlias(challengerId)}" & "${getPlayerAlias(playerChallengedId)}" because they are in the same place.`, reportedResult)
        return false
    }

    const challenger = playerScoreboard

    if (challenger.coins < 1) {// No remaining coins, so no more challenges
        logIgnoredMatch(`Ignored result because "${getPlayerAlias(challengerId)}" has 0 coins, so he cannot challenge "${getPlayerAlias(playerChallengedId)}"`, reportedResult)
        return false
    }

    if ( (challengerPlace - playerChallengedPlace) > challenger.range ) {// Challenger out of range
        logIgnoredMatch(`Ignored result because "${getPlayerAlias(challengerId)}" (place ${challengerPlace}) cannot reach "${getPlayerAlias(playerChallengedId)}" (place ${playerChallengedPlace}) with only ${challenger.range} of range`, reportedResult)
        return false
    }

    if ( doesPlayerAAlreadyWonAgainstThatPlace(challengerId, challenger.completed_challenges, playerChallengedPlace, rankingTable) ) {
        logIgnoredMatch(`Ignored result because "${getPlayerAlias(challengerId)}" already won against a player in the same place as "${getPlayerAlias(playerChallengedId)}" (place ${playerChallengedPlace})`, reportedResult)
        return false
    }

    return true;
}

const applyChallengerWinsScoringRules = challengerScore => ({
    ...challengerScore,
    range: challengerScore.range + 1,
})

const applyChallengerLosesScoringRules = challengerScore => ({
    ...challengerScore,
    coins: challengerScore.coins - 1
})

const applyPlayerChallengedWinsScoringRules = playerChallengedScore => ({
    ...playerChallengedScore,
    stand_points: playerChallengedScore.stand_points + 1
})

const updateInProgressScoreboard = (activities, rankingObj) => {

    if (typeof activities !== 'object') {
        throw new Error(`The "activities" argument must be an object but received "${typeof activities}" instead.`)
    }

    if (typeof rankingObj !== 'object') {
        throw new Error(`The "rankingObj" argument must be an object but received "${typeof rankingObj}" instead.`)
    }

    const { reportedResults } = activities, {ranking: rankingTable,  in_progress: { scoreboard } } = rankingObj
    const newScoreboard = reportedResults.reduce(
        (currentScoreboard, match) => {
            // {
            //     winner: player1Result > player2Result ? player1 : player2,
            //     player1, player2, player1Result, player2Result,
            //     players: [player1, player2]
            // }

            const { player1, player2, player1Result, player2Result, winner } = match
            const identifiedPlayersObj = identifyPlayers(player1, player2, rankingTable)
            const {
                challengerId, challengerPlace,
                playerChallengedId, playerChallengedPlace
            } = identifiedPlayersObj
            const challengerScore = currentScoreboard[challengerId] || getUnrankedPlayerScore(challengerPlace)


            if ( !isReportedResultValid(identifiedPlayersObj, rankingTable, challengerScore, match) ) {
                return currentScoreboard // if not valid we simply ignore this match
            }

            if (scoreboard[challengerId] && challengerScore.completed_challenges === scoreboard[challengerId].completed_challenges) {
                challengerScore.completed_challenges = [...scoreboard[challengerId].completed_challenges]
            }
            
            if (winner === challengerId) {
                currentScoreboard[challengerId] = applyChallengerWinsScoringRules(challengerScore)
                const playerWentToTheTop = (challengerPlace - currentScoreboard[challengerId].range) <= 0
                if (playerWentToTheTop) {
                    // Player basically see the credits & waits to start over
                    currentScoreboard[challengerId].coins = 0
                }
            }
            else {// Winner is player challenged
                currentScoreboard[challengerId] = applyChallengerLosesScoringRules(challengerScore)
                if ( !doesPlayerChallengedAlreadyWonAgainstThatChallenger(playerChallengedId, challengerScore.completed_challenges) ) {
                    currentScoreboard[playerChallengedId] = applyPlayerChallengedWinsScoringRules(currentScoreboard[playerChallengedId])
                }
            }

            challengerScore.completed_challenges.push(match)

            return currentScoreboard
        },
        { ...scoreboard }
    )

    return {
        ...rankingObj.in_progress,
        scoreboard: newScoreboard
    }
}

const getNextWeekObject = lastEndOfWeek => {
    const endDate = new Date(lastEndOfWeek)
    endDate.setDate(endDate.getDate() + 7);
    return {
        start: lastEndOfWeek + 1,
        end: endDate.getTime()
    }
}

const isItTimeToCommitInProgress = (nowDate, currentWeek) => {
    return currentWeek.end <= nowDate.getTime()
}

const getInitialCoinsForPlayer = playerPlace => {

    if (playerPlace === 1) {
        return 0
    }

    const result = Math.ceil(playerPlace / 5)
    return result > 5 ? 5 : result
}

const calculatePointsFromPlayerScore = playerScore => {
    const { stand_points, points, coins, range, initial_coins} = playerScore
    const result = points + stand_points + range - initial_coins - (initial_coins > 0 && coins === initial_coins ? 1 : 0)

    if (result < 0) {// Avoid negative points
        return 0
    }

    return result
}

const getRankingFromScoreboard = scoreboard => {
    const scoreDict = Object.keys(scoreboard).reduce(
        (resultObj, playerId) => {
            const { points, initial_coins, range} = scoreboard[playerId]
            const score = points + ( (range - initial_coins) / 1000 )

            if (score < 1) {// Ignoring the people with 0 points from the ranking
                return resultObj
            }

            if (!resultObj[score]) {
                resultObj[score] = []
            }

            resultObj[score].push(playerId)
            return resultObj
        },
        {}
    )

    return Object.keys(scoreDict).sort( (a, b) => b - a ).map(score => scoreDict[score])
}

const commitInProgress = rankingObj => {
    const result = { ...rankingObj }
    const inProgress = { ...result.in_progress }

    // Creates a clone of all player's score with updated points
    const newScoreboard = Object.keys(inProgress.scoreboard).reduce(
        (tmpScoreboard, playerId) => {
            tmpScoreboard[playerId] = {
                ...inProgress.scoreboard[playerId],
                points: calculatePointsFromPlayerScore(inProgress.scoreboard[playerId])
            }
            return tmpScoreboard
        },
        {}
    )

    // We need to generate the new ranking table in order to know how many coins 
    // the players should get at the end of week. Also we use the old ranking to 
    // calculatethe initial coins they have for the Tie-breaker.
    result.ranking = getRankingFromScoreboard(newScoreboard)


    // Applies inital completed_challenges, initial_coins, stand_points, coins and range
    const newInProgressScoreboard = Object.keys(newScoreboard).reduce(
        (tmpScoreboard, playerId) => {
            const playerPlace = getRankingPlaceByPlayerId(playerId, result.ranking)
            const initialCoins = getInitialCoinsForPlayer(playerPlace)
            tmpScoreboard[playerId] = {
                initial_coins: initialCoins, coins: initialCoins, range: initialCoins,
                points: newScoreboard[playerId].points, 
                stand_points: 0, completed_challenges: [],
            }
            return tmpScoreboard
        },
        {}
    )

    
    result.scoreboard = newScoreboard
    inProgress.scoreboard = newInProgressScoreboard
    result.last_update_ts = inProgress.last_update_ts
    result.in_progress = inProgress
    result.current_week = getNextWeekObject(result.current_week.end)
    return result
}

const getPlayersThatCanBeChallenged = (playerPlace, playerRange, rankingTable) => {
    let index = playerPlace - playerRange - 1
    if (index < 0) {
        index = 0
    }
    return rankingTable.slice(index, index + playerRange)
}


module.exports = {
    getRankingFromScoreboard,
    isItTimeToCommitInProgress,
    getRankingPlaceByPlayerId,
    commitInProgress,
    updateInProgressScoreboard,
    calculatePointsFromPlayerScore,
    getNextWeekObject,
    getUnrankedPlayerScore,
    getPlayersThatCanBeChallenged
}
