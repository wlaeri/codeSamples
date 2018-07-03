'use strict';

import {rootPath} from '../../globalVars.js';
import db from '../models';

//email and push notification functions
import {notifyPlayers, challengeNotification, challengeAccepted, challengeRejected, sendPushNotification} from '../worker/emails'

//utilities
import Promise from 'bluebird';
import multer from 'multer'
import crypto from 'crypto'

import express from 'express';
const router = express.Router();

//extract all Sequelize models from database 
const User = db.User;
const Game = db.Game;
const Task = db.Task;
const Event = db.Event;
const Challenge = db.Challenge;
const GamePlayers = db.GamePlayers;
const Mail = db.Mail;

//function to send cross-platform push notifications, as needed 
const chorePushNotification = (completedBy, chore, deviceToken, currentBadge, data) => {
	const body =  completedBy.username + ' just completed ' + chore.name + '!'

	sendPushNotification(deviceToken, body, currentBadge, data)
	.then((result) => {
		console.log('sent***', result)
	})
	.catch((err) => {
		console.log('error**', err)
	})
}


//generic GET route, to get all the tasks in a game
router.get('/task/:id', function(req, res, next){
	Event.findAll({where: {taskId: req.params.id}})
	.then(events=>res.send(events))
	.catch(next);
});

//add new task to game
router.post('/', function(req, res, next){
	Event.create(req.body)
	.then(event=> res.sendStatus(200))
	.catch(next);
})

//middleware function for handling multipart/form-data, in this case to upload photos
const storage = multer.diskStorage({
  destination: rootPath + 'public/',
  filename: function (req, file, cb) {
    crypto.pseudoRandomBytes(16, function (err, raw) {
      cb(null, raw.toString('hex') + Date.now() + '.' + 'jpg');
    });
  }
});

const upload = multer({ storage });

//process newly completed chore, save before / after pics to disk, update game, and alert players
router.post('/images/:userId/:gameId/:taskId/', upload.fields([{name: 'beforePic', maxCount: 1}, {name: 'afterPic', maxCount: 1}]), function(req, res, next){

	const beforePicKey = req.files.beforePic[0].filename 
	const afterPicKey = req.files.afterPic[0].filename 
	
	//initialize storage values outside of the promise chain
	let user, task, event;
	
	//create a new event instance in sequelize
	Event.create({
		completedById: req.params.userId, 
		gameId: req.params.gameId, 
		taskId: req.params.taskId, 
		beforePic: beforePicKey, 
		afterPic: afterPicKey
	})
	
	//then save the newly created event and send the results back to the client
	.then(createdEvent => {
		event = createdEvent
		res.send({beforePicKey, afterPicKey, event})
	})
	
	//find and save the user
	.then(() => User.findById(req.params.userId))
	.then(foundUser => user = foundUser)
	
	//find and save the task
	.then(() => Task.findById(req.params.taskId))
	.then(foundTask => task = foundTask)
	
	//find the game players
	.then(() => Game.findById(req.params.gameId))
	.then(game => game.getUsers())
	
	//map through the game players and send them emails and/or push notifications notifying them of the new chore
	.then(players => {
		const data = {gameId: req.params.gameId, route: 'GameView'}
		players.map((player) => {
			if (player.dataValues.eventNotifications && player.dataValues.id != user.dataValues.id) notifyPlayers(task, player, user, event)
			if (player.dataValues.deviceToken && player.dataValues.id != user.dataValues.id) chorePushNotification(user.dataValues, task.dataValues, player.dataValues.deviceToken, player.dataValues.badge, data)
		})
		//increment player activity badge numbers on the backend
		return Promise.all(players.map(player => player.update({badge: player.badge + 1})))
	})
	.then(()=> user.update({lifetimeSuds: user.lifetimeSuds + 5}))
	
	//print corresponding error to the console if there is an error in the promise chain
	.catch(err => console.log('error*** in android upload event pics', err))
})

router.post('/challenge/:eventId/:challengerId/:commissionerId', function(req, res, next){

	//initialize storage values outside of the promise chain
	let commissioner, challenger, task, player, challenge, event;

	//create a new challenge using data from the request body contents and params
	Challenge.create({
		description: req.body.description,
		eventId: req.params.eventId,
		commissionerId: req.params.commissionerId, 
		userId: req.params.challengerId,
		gameId: req.body.gameId
	})
	.then(newChallenge => {
		//extract the dataValues from the newly created challenge object returned by the promise
		challenge = newChallenge.dataValues;
		//send that newly created challenge to the client
		res.send(challenge)
		
		//asynchronously find the commissioner, challenger, and completed chore from the backend
		return Promise.all([
			User.findById(req.params.commissionerId),
			User.findById(req.params.challengerId),
			Event.findById(challenge.eventId),
		]);
	})
	.then(function (results) {
		//process the results from the Promise.all
		commissioner = results[0]['dataValues'];
		challenger = results[1]['dataValues'];
		event = results[2]['dataValues'];
		
		//asynchronously query the backend for the chore and user who completed that chore
		return Promise.all([
			Task.findById(event.taskId),
			User.findById(event.completedById)
		]);
	})
	.then(function(results){
		// process the results from the Promise.all
		task = results[0]['dataValues'];
		player = results[1]['dataValues'];
		
		try {
			//send the challenge 
			challengeNotification(commissioner, challenger, task, player, challenge, event);
			Mail.create({
				recipientId: commissioner.id,
				userId: challenger.id,
				type: 'eventChallenged',
				challengeId: challenge.id,
				eventId: event.id, 
				gameId: event.gameId
			})
		}
		catch(e) {
			//if the above code block throws an error, print that error to the console
			console.log('caught error:', e);
		}
	})
	.catch(next)
})

//route for commissioner making a decision on challenge
router.put('/challenge', function(req, res, next){

	//initialize storage values outside of the promise chain
	let commissioner, challenger, task, player, challenge, event, game, eventInstance;
	
	//find the challenge that is being accepted or rejected
	Challenge.findById(req.body.challengeId)
	.then(foundChallenge => {
		//update challenge status with the commissioner ruling 
		return foundChallenge.update({status: req.body.decision})
	})
	.then(updatedChallenge => {
		//store challenge object
		challenge = updatedChallenge.dataValues;

		//send an OK response to the client
		res.sendStatus(200)
		
		//asynchronously look up challenger and event by id
		return Promise.all([
			User.findById(challenge.userId),
			Event.findById(challenge.eventId),
		]);
	})
	.then(results => {

		//process and store the results from the Promise.all
	    challenger = results[0]['dataValues'];
	    event = results[1]['dataValues'];
	    eventInstance = results[1];

	    //asynchronously find the chore, user, and game from the backend
	    return Promise.all([
	    	Task.findById(event.taskId),
	    	User.findById(event.completedById),
	    	Game.findById(event.gameId)
	    ]);
	})
	.then(results => {

		//process and store the results from the Promise.all
		task = results[0]['dataValues'];
		player = results[1]['dataValues'];
		let game = results[2]['dataValues'];

		//asynchronously query the backend for game players and commissioner
		return Promise.all([
			results[2].getUsers(),
			User.findById(game.commissionerId),
		]);
	})
	.then(function(results){
		//process and store the results from the Promise.all
		let players = results[0].map(player => player.dataValues);
		commissioner = results[1]['dataValues'];
		
		//update event, if necessary, and inform players of the commissioner's decision by email / push notification
		try {
			if(req.body.decision == 'Rejected') {
				//send out challenge rejected emails
				challengeRejected(commissioner, challenger, task, player, challenge, event)
				//create new mail instance for internal mail messaging system
				Mail.create({
					recipientId: challenger.id,
					type: 'challengeRejected', 
					challengeId: challenge.id, 
					eventId: event.id, 
					gameId: event.gameId
				})
			}
			else if(req.body.decision == 'Accepted') {
				eventInstance.update({rejected: false})
				.then(() => {
					players.map(recipient => {
						//send out challenge accepted emails
						challengeAccepted(commissioner, challenger, task, player, challenge, event, recipient)
						//create new mail instance for internal mail messaging system
						Mail.create({
							recipientId: recipient.id, 
							type: 'challengeAccepted', 
							challengeId: challenge.id, 
							eventId: event.id, 
							gameId: event.gameId, 
							userId: challenger.id
						})
					})
				})
				.catch(err => console.log('Unable to update challenge:', err))
				
			}
			else throw new Error('Invalid challenge decision.')
		}
		catch(e) {
			console.log('caught error:', e);
		}
	})
	.catch(next)

})

module.exports = router;