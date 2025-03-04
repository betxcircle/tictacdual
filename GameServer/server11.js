const socketIOOO = require('socket.io');
const OdinCircledbModel = require('../models/odincircledb');
const BetModel = require('../models/BetModel');
const WinnerModel = require('../models/WinnerModel');
const LoserModel = require('../models/LoserModel');
const BetCashModel = require('../models/BetCashModel');
const Device = require('../models/Device');

const activeRooms = {};

const { Expo } = require('expo-server-sdk'); // Import expo-server-sdk

const expo = new Expo(); // Initialize Expo SDK

const startSocketServer11 = (httpServer) => {
    const iooo = socketIOOO(httpServer);

    iooo.on('connection', (socket) => {
        console.log('A user connected tic11');
      
   
        socket.on('joinRoom', async ({ playerName, roomId, userId, totalBet, expoPushToken }) => {
          // Validate input
          if (!playerName || !userId || !roomId) {
            return socket.emit('invalidJoin', 'Player name, userId, and roomId are required');
          }
        
          // Check if the room exists
          let room = activeRooms[roomId];
        
          if (!room) {
            // Create a new room if it doesn't exist
            room = {
              roomId,
              players: [],
              board: Array(9).fill(null),
              currentPlayer: 0,
              startingPlayer: 0, // Track who starts
              player1Bet: null,
              player2Bet: null,
            };
            activeRooms[roomId] = room;
          }
        
          // Prevent more than 2 players from joining the same room
          if (room.players.length >= 2) {
            return socket.emit('roomFull', 'This room already has two players');
          }
        
          // Determine player number and symbol
          const playerNumber = room.players.length + 1;
          const playerSymbol = playerNumber === 1 ? 'X' : 'O';
        
          // Add the player to the room
          room.players.push({
            name: playerName,
            userId,
            socketId: socket.id,
            totalBet,
            playerNumber,
            symbol: playerSymbol,
            expoPushToken, // Store push token for notifications
          });
        
          // Join the socket.io room
          socket.join(roomId);
        
          // Notify other players in the room about the new player
          socket.to(roomId).emit('playerJoined', `${playerName} joined the room`);
        
          // Send the current room state to the new player
          socket.emit('roomState', {
            player1Bet: room.player1Bet,
            player2Bet: room.player2Bet,
          });
        
          // Send individual player information to the player who joined
          socket.emit('playerInfo', {
            playerNumber: room.players.length,
            symbol: playerSymbol,
            playerName: playerName,
            roomId: room.roomId,
            userId: userId
          });
        
          // Emit the updated player list to everyone in the room
          iooo.to(roomId).emit('playersUpdate', room.players);
        
          // Check if the room now has two players
          if (room.players.length === 2) {
            // Notify both players that the game is ready
            iooo.to(roomId).emit('twoPlayersJoined', {
              player1Name: room.players[0].name,
              player2Name: room.players[1].name,
              player1Symbol: room.players[0].symbol,
              player2Symbol: room.players[1].symbol,
              roomId,
            });
        
            room.currentPlayer = room.startingPlayer;
        
            // Notify players about whose turn it is
            iooo.to(roomId).emit('turnChange', room.currentPlayer);
        
            const firstPlayer = room.players[0]; // Retrieve the first player's info
            console.log('First Player Info:', firstPlayer);
        
            // Fetch first player's push token from the database
            const recipient = await OdinCircledbModel.findById(firstPlayer.userId); // Assuming `userId` matches DB _id
      
          if (recipient && recipient.expoPushToken) {

          // Notification details
          const notificationTitle = 'Game Ready!';
          const notificationBody = `${playerName} has joined. The game is ready to start!`;
          const notificationData = { roomId, playerName };

          // Send the push notification
          await sendPushNotification(
            recipient.expoPushToken,
            notificationTitle,
            notificationBody,
            notificationData
          );

          console.log('Push notification sent successfully to the first player.');
        } else {
          console.log('No valid Expo push token found for the first player.');
        }

          }
        });

        // Function to send push notifications
async function sendPushNotification(expoPushToken, title, body, data = {}) {
  try {
    // Validate if the token is a valid Expo push token
    if (!Expo.isExpoPushToken(expoPushToken)) {
      console.error(
        `Push token is not a valid Expo push token`
      );
      return;
    }

    // Create the notification payload
    const message = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
      // icon: 'https://as1.ftcdn.net/v2/jpg/03/06/02/06/1000_F_306020649_Kx1nsIMTl9FKwF0jyYruImTY5zV6mnzw.jpg', // Include the icon if required
    };

    // Split messages into chunks for sending
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    // Send the notification in chunks
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

  socket.on("forceTurnChange", (data = {}) => {
  const { roomId } = data;

  if (!roomId) {
    console.error("forceTurnChange event received without roomId");
    return;
  }

  if (activeRooms[roomId]) {
    console.log("Forcing turn change due to timeout...");
    activeRooms[roomId].currentPlayer = (activeRooms[roomId].currentPlayer + 1) % 2;
    iooo.to(roomId).emit("turnChange", activeRooms[roomId].currentPlayer);
  } else {
    console.error(`Room ${roomId} not found for forceTurnChange`);
  }
});


socket.on('makeMove', async ({ roomId, index, playerName, symbol }) => {
  const room = activeRooms[roomId];

  // Check if room exists and has a players array
  if (!room || !Array.isArray(room.players)) {
    console.error(`Invalid room or players array for roomId: ${roomId}`);
    return socket.emit('invalidMove', 'Invalid game state');
  }

  // Initialize room.currentPlayer if necessary
  if (typeof room.currentPlayer !== 'number') {
    console.error(`Invalid currentPlayer for roomId: ${roomId}`);
    room.currentPlayer = 0; // Default to player 0
  }

  if (!room) {
    return socket.emit('invalidMove', 'Room not found');
  }

  const currentPlayerIndex = room.currentPlayer % 2;
  const currentPlayer = room.players[currentPlayerIndex];

  // Check if there's only one player in the room
  if (room.players.length < 2) {
    return socket.emit('invalidMove', 'Waiting for another player to join');
  }

  if (socket.id === currentPlayer.socketId) {
    if (room.board[index] === null) {
      room.board[index] = currentPlayer.symbol;
      room.currentPlayer++;

      iooo.to(roomId).emit('turnChange', room.currentPlayer % 2);
      iooo.to(roomId).emit('moveMade', {
        index,
        symbol: currentPlayer.symbol,
        playerName: currentPlayer.name
      });

      const winnerSymbol = checkWin(room.board);
      if (winnerSymbol) {
        const winnerPlayer = room.players.find(player => player.symbol === winnerSymbol);
        const loserPlayer = room.players.find(player => player.symbol !== winnerSymbol); // Find the loser
      
        if (winnerPlayer && loserPlayer) {
          const winnerUserId = winnerPlayer.userId;
          const loserUserId = loserPlayer.userId;
          const gameResult = `${winnerPlayer.name} (${winnerSymbol}) wins!`;

          // Access the totalBet from the room object
          const totalBet = room.totalBet;

          // Emit 'gameOver' event with winner and loser info
          iooo.to(roomId).emit('gameOver', { 
            winnerSymbol, 
            result: gameResult, 
            totalBet, 
            winnerUserId, 
            winnerPlayer, 
            loserUserId, 
            loserPlayer 
          });

          try {
            // Update the winner's balance in the database
            const winnerUser = await OdinCircledbModel.findById(winnerUserId);
            if (winnerUser) {
              // Add total bet amount to winner's balance
              winnerUser.wallet.cashoutbalance += totalBet;
              await winnerUser.save();

              // Save winner record
              const newWinner = new WinnerModel({
                roomId,
                winnerName: winnerUserId,
                totalBet: totalBet,
              });
              await newWinner.save();
              console.log('Winner saved to database:', newWinner);

              // Save loser record
              const newLoser = new LoserModel({
                roomId,
                loserName: loserUserId,
                totalBet: totalBet,
              });
              await newLoser.save();
              console.log('Loser saved to database:', newLoser);
            } else {
              console.error('Winner user not found');
            }
          } catch (error) {
            console.error('Error updating winner balance:', error);
          }
        }
      } else if (room.board.every((cell) => cell !== null)) {
        // It's a draw
        iooo.to(roomId).emit('gameDraw', { 
          winnerSymbol: null, 
          result: "It's a draw!", 
          winnerUserId: null 
        });

        // Reset the game state for a new game
        room.board = Array(9).fill(null);
        room.startingPlayer = (room.startingPlayer + 1) % 2;
        room.currentPlayer = room.startingPlayer;

        iooo.to(roomId).emit('newGame', { message: "The game has been reset due to a draw. New game starting!" });
      } else {
        socket.emit('invalidMove', 'Cell already occupied');
            socket.emit('invalidMove', 'It\'s not your turn');
      }
    }
  }
});



              // Check for a win or draw
  //     const winnerSymbol = checkWin(room.board);
  //     if (winnerSymbol) {
  //       const winnerPlayer = room.players.find(player => player.symbol === winnerSymbol);
  //       const loserPlayer = room.players.find((player) => player.symbol !== winnerSymbol); // Find the loser
  //       if (winnerPlayer) {
  //         const winnerUserId = winnerPlayer.userId;
  //         const loserUserId = loserPlayer.userId;
  //         const gameResult = `${winnerPlayer.name} (${winnerSymbol}) wins!`;
          
  //         // Access the totalBet from the room object
  //         const totalBet = room.totalBet;

  //         // Emit 'gameOver' event with winner, total bet, and winner user ID
  //         iooo.to(roomId).emit('gameOver', { winnerSymbol, result: gameResult, totalBet, winnerUserId, winnerPlayer, loserUserId, loserPlayer  });

  //         try {
  //           // Update the winner's balance in the database
  //           const winnerUser = await OdinCircledbModel.findById(winnerUserId);
  //           if (winnerUser) {
  //             // Add the total bet amount to the user's cashoutBalance
  //             winnerUser.wallet.cashoutbalance += totalBet;
  //             await winnerUser.save();

  //             try {
  //               const newWinner = new WinnerModel({
  //                     roomId,
  //                     winnerName: winnerUserId,
  //                     totalBet: totalBet,
  //               });
  //             await newWinner.save();
  //             console.log('Bet saved to database:', newWinner);
  //                  // Save loser record
  //             const newLoser = new LoserModel({
  //               roomId,
  //               loserName: loserPlayer.name,
  //               totalBet: totalBet,
  //             });
  //             await newLoser.save();
  //             console.log('Loser saved to database:', newLoser);
  //           } else {
  //             console.error('Winner user not found');
  //           }
  //         } catch (error) {
  //           console.error('Error updating winner balance:', error);
  //         }
  //       }
  //     } else if (room.board.every((cell) => cell !== null)) {
  //       // It's a draw
  //       iooo.to(roomId).emit('gameDraw', { winnerSymbol: null, result: "It's a draw!", winnerUserId: null });
  //        // Reset the game state for a new game
  //        room.board = Array(9).fill(null); // Reset the board
  //        room.startingPlayer = (room.startingPlayer + 1) % 2; // Toggle the starting player
  //        room.currentPlayer = room.startingPlayer;
  //        iooo.to(roomId).emit('newGame', { message: "The game has been reset due to a draw. New game starting!" });
  //     }
  //   } else {
  //     socket.emit('invalidMove', 'Cell already occupied');
  //   }
  // } else {
  //   socket.emit('invalidMove', 'It\'s not your turn');
  // }

socket.on('placeBet', async ({ roomId, userId, playerNumber, playerName, betAmount }) => {
  
   // Initialize room if it doesn't exist
   if (!activeRooms[roomId]) {
    activeRooms[roomId] = {
      player1Bet: 0,
      player2Bet: 0,
      player1UserId: null,
      player2UserId: null,
      totalBet: 0,
    };
  }

  const room = activeRooms[roomId]; // Safely reference the room object

  // Store the bet amount and user ID in variables based on player number
  let playerBet;
  let otherPlayerBet;
  let playerUserId;
  let otherPlayerUserId;

  if (playerNumber === 1) {
    playerBet = betAmount;
    otherPlayerBet = activeRooms[roomId].player2Bet;
    playerUserId = userId;
    otherPlayerUserId = activeRooms[roomId].player2UserId;
    activeRooms[roomId].player1Bet = betAmount;
    activeRooms[roomId].player1UserId = userId;
    playerName = userId;

    // Save Player 1's bet to the BetModel
    try {
      const newBet = new BetModel({
        roomId,
        playerName,
        betAmount,
      });
      await newBet.save();
     
     const maskedName = maskPlayerName(playerName);
     
        const notificationTitle = 'New Bet Placed!';
        const notificationMessage = `Player ${maskedName} has placed a bet of ${betAmount} Naira`;
        await sendNotificationsToDevices(notificationTitle, notificationMessage);
    } catch (error) {
      console.error('Error saving Player 1\'s bet to BetModel:', error.message);
    }
  } else if (playerNumber === 2) {
    // Store Player 2's bet without saving it to BetModel
    playerBet = betAmount;
    otherPlayerBet = activeRooms[roomId].player1Bet;
    playerUserId = userId;
    otherPlayerUserId = activeRooms[roomId].player1UserId;
    activeRooms[roomId].player2Bet = betAmount;
    activeRooms[roomId].player2UserId = userId;
    playerName = userId;
  }

  // Save both Player 1 and Player 2's bets to the BetCashModel (for both players)
  try {
    const betCash = new BetCashModel({
      roomId,
      playerName,
      betAmount,
    });
    await betCash.save();
    console.log('Both bets saved to BetCashModel database:', betCash);
  } catch (error) {
    console.error('Error saving bets to BetCashModel:', error.message);
  }

  // Check if both players have placed their bets

  const { player1Bet, player2Bet, player1UserId, player2UserId } = room;

  if (player1Bet > 0 && player2Bet > 0) {
    const totalBet = player1Bet + player2Bet;

    // Store the totalBet in the room object
    room.totalBet = totalBet;

    // Emit 'betPlaced' event to all clients in the room with updated bet information
    iooo.to(roomId).emit('betPlaced', { 
      player1UserId, 
      player1Bet, 
      player2UserId, 
      player2Bet, 
      totalBet,
    });

    // Check if player1Bet equals player2Bet
    if (player1Bet === player2Bet) {
      // Emit 'equalBet' event if the bets are equal
      iooo.to(roomId).emit('equalBet', { 
        player1UserId, 
        player1Bet, 
        player2UserId, 
        player2Bet 
      });

      // Deduct the bet amount from the user's balance in the database
      try {
        // Deduct the bet amount from the player's balance
        const playerUser = await OdinCircledbModel.findById(playerUserId);
        const otherPlayerUser = await OdinCircledbModel.findById(otherPlayerUserId);

        if (!playerUser || !otherPlayerUser) {
          throw new Error('User not found');
        }

        playerUser.wallet.balance -= playerBet;
        otherPlayerUser.wallet.balance -= otherPlayerBet;

        await Promise.all([playerUser.save(), otherPlayerUser.save()]);

        console.log(`Bet amounts deducted from users ${playerUserId} and ${otherPlayerUserId}: ${playerBet}, ${otherPlayerBet}`);
      } catch (error) {
        console.error('Error deducting bet amount from user balance:', error.message);
      }
    } else {
      // If the bets are not equal, notify the clients and reset the bet amounts
      iooo.to(roomId).emit('unequalBet', {
        player1UserId,
        player1Bet,
        player2UserId,
        player2Bet,
      });

      console.log('Bets are unequal. Resetting bet amounts.');

      // Reset the bet amounts and user IDs
      room.player1Bet = 0;
      room.player2Bet = 0;
    }
  }
});


   
function maskPlayerName(name) {
  if (name.length <= 2) {
    // If the name is very short, mask it entirely
    return '*'.repeat(name.length);
  }
  const firstChar = name[0]; // First character remains visible
  const lastChar = name[name.length - 1]; // Last character remains visible
  const maskedMiddle = '*'.repeat(name.length - 2); // Mask the middle characters
  return `${firstChar}${maskedMiddle}${lastChar}`;
}

     
socket.on('sendMessage', ({ roomId, playerName, message }) => {

  iooo.to(roomId).emit('receiveMessage', { playerName, message });
});



socket.on('disconnect', async () => {
  console.log('User disconnected');

  // Find the room where the player has disconnected
  const roomId = Object.keys(activeRooms).find(roomId => {
    const room = activeRooms[roomId];
    // Safeguard: Ensure the room exists and has a players array
    return room && Array.isArray(room.players) && room.players.some(player => player.socketId === socket.id);
  });

  if (roomId) {
    console.log(`Player disconnected from room ${roomId}`);

    const room = activeRooms[roomId];
    room.players = room.players.filter(player => player.socketId !== socket.id); // Remove the disconnected player

    if (room.players.length === 0) {
      // If no players are left, delete the room
      delete activeRooms[roomId];

      try {
        // Delete the room from the database
        const result = await BetModel.deleteOne({ roomId });
        if (result.deletedCount > 0) {
          console.log(`Room ${roomId} successfully deleted from the database.`);
        } else {
          console.warn(`Room ${roomId} not found in the database.`);
        }
      } catch (err) {
        console.error(`Error deleting room ${roomId} from the database:`, err);
      }
    } else {
      console.log(`Remaining players in room ${roomId}:`, room.players);
    }
  }
});



// Function to send notifications to registered devices
async function sendNotificationsToDevices(title, message) {
  try {
    // Fetch all devices from the database
    const devices = await Device.find({});

    // Extract the expoPushToken from each device
    const tokens = devices.map((device) => device.expoPushToken);

    if (tokens.length === 0) {
      console.warn('No devices registered for notifications');
      return;
    }

    // Filter out invalid tokens and prepare messages
    const messages = tokens
      .filter((token) => Expo.isExpoPushToken(token)) // Ensure token is valid
      .map((token) => ({
        to: token,
        sound: 'default',
        title,
        body: message,
      }));

    if (messages.length === 0) {
      console.warn('No valid Expo push tokens found');
      return;
    }

    // Chunk messages into batches to send with Expo
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    // Send notifications in chunks
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log('Sent notification chunk:', ticketChunk);
      } catch (error) {
        console.error('Error sending notification chunk:', error);
      }
    }
  } catch (error) {
    console.error('Error sending notifications:', error.message);
    console.error('Error stack:', error.stack);
  }
}

      function checkWin(board) {
        // Validate board
        if (!Array.isArray(board) || board.length !== 9) {
          console.error('Invalid game board:', board);
          return null; // Return null or throw an error
        }
      
        const winPatterns = [
          [0, 1, 2],
          [3, 4, 5],
          [6, 7, 8],
          [0, 3, 6],
          [1, 4, 7],
          [2, 5, 8],
          [0, 4, 8],
          [2, 4, 6],
        ];
      
        for (const condition of winPatterns) {
          const [a, b, c] = condition;
          if (board[a] && board[a] === board[b] && board[b] === board[c]) {
            return board[a]; // Return the winning symbol
          }
        }
      
        // Check for a draw (all cells are filled)
        if (board.every(cell => cell !== null)) {
          return null; // It's a draw
        }
      
        return null; // No winner yet
      }


      function generateRoomId() {
        return Math.random().toString(36).substr(2, 9); // Generate a random alphanumeric string
      }

}

    )}

    
module.exports = startSocketServer11;

