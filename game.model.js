'use strict';

import db from './db';
import Sequelize from 'sequelize';

import User from './user.model.js';
import Task from './task.model.js';
import Cron from './cron.model.js';
import GamePlayers from './gamePlayers.model.js';

//utilities
import Moment from 'moment';
import Promise from 'bluebird';
import phoneFormatter from 'phone-formatter';

module.exports = db.define('game', {
    name: {
        type: Sequelize.STRING,
        allowNull: false,
    },
    duration: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    period: {
        type: Sequelize.ENUM('days', 'weeks', 'months',),
        defaultValue: 'days',
    },
    start: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    end: {
        type: Sequelize.DATE,
    },
    locked: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
    },
    resolved: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
    },
    deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
    },
    status: {
        type: Sequelize.ENUM('Draft', 'Pending', 'Active', 'Completed'),
        allowNull: false,
        defaultValue: 'Active',
    }
}, 

{
    instanceMethods: {
        
        //this method checks to see whether all game players have confirmed before start
        initiationCheck: function() {
            return GamePlayers.findAll({
                where: {gameId: this.id}
            })
            .then(gamePlayers => gamePlayers.filter(gp => !gp.confirmed))
            .then(array => array.length == 0)
        },

        //this method sets players status within the GamePlayers table as part of this game
        //then returns all of the users on the game
        addPlayersSetComm: function(users, commissioner, autojoin) {

            //map through users array and return queried user promise
			const promisesForInvitedUsers = users.map(user => {

                const newNumber = !user.phone ? '' : phoneFormatter.normalize(user.phone)

                if (!newNumber) {
                    return User.findOrCreate({
                        where: {email: user.email}
                    })
                }
                else{
                    return User.findOrCreate({
                        where: {phone: newNumber}
                    })
                }
			})

			return Promise.all(promisesForInvitedUsers)
			.then((invitedUsers) => {

                //map through invitedUsers and update invited field for relevant users
				const promisesForUpdatedInvitedUsers = invitedUsers.map((userData, index) => {
                    const user = userData[0]
                    return !user.password ? user.update({invited: true}) : user
                });

                return Promise.all(promisesForUpdatedInvitedUsers)
            })
            .then(updatedInvitedUsers => {

                //generate array of IDs
                const userIds = updatedInvitedUsers.map(user => user.id)

                //add users to game
                return this.addUsers(userIds, { confirmed: true, invited: false })
			})

            //set commissioner
            .tap(() => this.setCommissioner(commissioner))

            //return game users
            .then(() => this.getUsers())

            //catch and print runtime errors to console
            .catch(err => console.log('Error in addPlayersSetComm', err))
        },

        //this method adds and invites new players to a game after an update
        addPlayersGameUpdate: function(usersObj, currGPs, commissioner) {

            //query users from usersObj
            const userPromiseArray = usersObj.map(user => User.findOrCreate({
                where: {email: user.email}
            }));

            return Promise.all(userPromiseArray)
            .then(users => {

                //generate ID array of current game players
                const alreadyJoined = currGPs.map(gp => gp.userId);

                //find players that haven't been invited yet
                const newInvites = users.map(user => user[0].id)
                .filter(user => alreadyJoined.indexOf(user) == -1);
     
                //add new invites to game
                return this.addUsers(newInvites, { confirmed: true })
            })

            //return full game instance
            .then(() => this)

            //
            .catch(err => console.log('Error in addPlayersGameUpdate', err))
        },

        //this method updates tasks associated with game on update
        updateTasks: function(incomingTasks) {

            //create new task instances from incomingTasks parameter
            return Promise.all(incomingTasks.map(task => {
                //remove IDs if they exist
                if (task.id) { delete task.id; }
                return Task.create(task);
            }))

            //set tasks to game
            .then(tasks => this.setTasks(tasks.map(task => task.id)))

            //return full game instance
            .then(() => this)
        },

        //this method updates all game metadata
        updateGameFromReqBody: function(input) {
            let updatedGame = Object.assign({}, input);
            delete updatedGame.users;
            delete updatedGame.tasks;
            delete updatedGame.events;
            return this.update(updatedGame);
        },

        //this method creates a cron model instance to persist cron activity
        createCron: function() {
            Cron.create({
                startDate: this.start,
                endDate: this.end
            })
            .then(cron => cron.setGame(this.id))
            .catch(err => console.log('Error in createCron', err))
        }
    }
});