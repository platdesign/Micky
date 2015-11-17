'use strict';


var angular = require('angular');
var ngStorage = require('ngstorage');
var hawk = require('angular-hawk');
var oz = require('angular-oz');


var mod = module.exports = angular.module('Micky', [
	ngStorage.name,
	hawk.name,
	oz.name
]);


mod.provider('Micky', function() {

	var clientConfigs = {};
	this.client = function(name, config) {
		config.name = name;
		clientConfigs[name] = config;
	};





	this.$get = ['$http', 'Hawk', 'Oz', '$localStorage', '$q', '$rootScope',
	function($http, Hawk, Oz, $localStorage, $q, $rootScope) {


		var service = {};

		// Instantiate clients
		Object.keys(clientConfigs).forEach(function(name) {
			var config = clientConfigs[name];

			service[name] = new Client(config);
		});








		function Client(options) {

			var baseOptions = {
				url: '',
				authHeaderName: 'authorization',
				routes: {
					reissue: '/auth/reissue',
					app: '/auth/app',
					signin: '/auth/signin',
					rsvp: '/auth/rsvp'
				}
			};

			options = angular.merge({}, baseOptions, options);



			$rootScope.$watch(function() {
			    return getTicket('auth');
			}, function(a, b) {
				if(a === b) { return; }
				if(a) {
					$rootScope.$broadcast('Micky:'+options.name+':updatedAuthTicket');
				} else {
					$rootScope.$broadcast('Micky:'+options.name+':removedAuthTicket');
				}
			});



			this.get = function(path, config) {
				return request('GET', path, null, config);
			};

			this.post = function(path, data, config) {
				return request('POST', path, data, config);
			};

			this.put = function(path, data, config) {
				return request('PUT', path, data, config);
			};

			this.delete = function(path, data, config) {
				return request('DELETE', path, data, config);
			};





			/**
			 * Authenticate a use on the app
			 * @param  {Object} credentials user credentials
			 * @return {Promise}             Resolves with user ticket
			 */
			this.authenticate = function(credentials) {

				if(!credentials.email || !credentials.password) {
					throw new Error('Missing credential information');
				}

				credentials = angular.copy(credentials);

				return request('POST', options.routes.signin, { credentials: credentials })
				.then(function(res) {
					return request('POST', options.routes.rsvp, res.data);
				})
				.then(function(res) {
					saveTicket('auth', res.data);
					$rootScope.$broadcast('Micky:'+options.name+':authenticated');
					return res.data;
				});

			};



			/**
			 * checks if api is authenticated
			 * @return {Promise} resolves with valid auth-ticket if available
			 */
			this.isAuthenticated = function() {
				return reissueTicket('auth');
			};



			/**
			 * Get storage key from name for ticket
			 * @param  {String} name Ticket name
			 * @return {String}      Storage key
			 */
			function getTicketStorageKey(name) {
				return 'ticket:'+options.name+':'+name;
			}

			/**
			 * Read ticket from store
			 * @param  {String} name Ticket name
			 */
			function getTicket(name) {
				return $localStorage[getTicketStorageKey(name)];
			}


			/**
			 * Save a ticket in store
			 * @param  {String} name   Ticket name
			 * @param  {Object} ticket Ticket
			 */
			function saveTicket(name, ticket) {
				ticket.____createdAt = Date.now();
				$localStorage[getTicketStorageKey(name)] = ticket;
			}

			/**
			 * Delete ticket from stro
			 * @param  {String} name Ticketname
			 */
			function deleteTicket(name) {
				delete $localStorage[getTicketStorageKey(name)];
			}


			/**
			 * Request app ticket
			 * @param  {Object} credentials optional app credentials
			 * @return {Promise}             Resolves with app ticket object
			 */
			var requestAppTicket = function(credentials) {

				credentials = credentials || options.credentials;

				if(!credentials) {
					throw new Error('Missing app credentials');
				}

				return requestWithTicket('POST', options.routes.app, null, null, credentials)
					.then(function(res) {
						saveTicket('app', res.data);
						return res.data;
					});

			};


			/**
			 * Request with ticket
			 * adds the oz-authorization-header
			 * @param  {String} method    GET|POST|PUT|DELETE
			 * @param  {String} path      resource-path
			 * @param  {Object} payload   request payload
			 * @param  {Object} reqConfig request config
			 * @param  {Object} ticket    Ticket
			 * @return {Promise}          resolves with response
			 */
			function requestWithTicket(method, path, payload, reqConfig, ticket) {

				reqConfig = angular.copy(reqConfig) || {};

				var headers = {};

				angular.merge(reqConfig, {
					url: options.url + path,
					method: method.toLowerCase(),
					data: payload,
					headers: {}
				});

				reqConfig.headers[options.authHeaderName] = Oz.client.header(reqConfig.url, reqConfig.method, ticket, {
					timestamp: Date.now() / 1000
				}).field;

				return $http(reqConfig)
					// .then(function(res) {
					// 	return res.data;
					// }, function(res) {
					// 	return $q.reject(res.data);
					// });

			}


			/**
			 * Reissues a ticket and stores it
			 * @param  {Object} ticket Ticket object
			 * @return {Promise}       Resolves with reissued ticket
			 */
			function reissueTicketRequest(ticket) {

				return requestWithTicket('POST', options.routes.reissue, null, null, ticket)
				.then(function(res) {
					return res.data;
				});

			}


			/**
			 * Reissue a ticket if needed
			 * @param  {String} name   Ticket name
			 * @param  {Object} ticket Ticket
			 * @return {Promise}       resolves with ticket
			 */
			function reissueTicket(name, ticket) {
				ticket = ticket || getTicket(name);

				if(!ticket) {
					return $q.reject('Cant find ticket to reissue');
				}

				var lifetime = ticket.exp - ticket.____createdAt;
				var remaining = ticket.exp - Date.now();

				if(remaining < (lifetime/2)) {
					return reissueTicketRequest(ticket)
						.then(function(ticket) {
							saveTicket(name, ticket);
							return ticket;
						}, function() {
							deleteTicket(name);
							return $q.reject();
						});
				} else {
					return $q.when(ticket);
				}
			}



			/**
			 * Request api
			 * @param  {String} method GET|POST|PUT|DELETE
			 * @param  {String} path   resource path
			 * @param  {Object} data   request-payload
			 * @param  {Object} config request config
			 * @return {Promise}       resolves with response
			 */
			function request(method, path, data, config) {

				var promise;

				var authTicket = getTicket('auth');

				if(authTicket) {
					promise = reissueTicket('auth', authTicket);
				} else {

					var appTicket = getTicket('app');

					if(appTicket) {
						promise = reissueTicket('app', appTicket)
						.catch(function() {
							return requestAppTicket();
						});
					} else {
						promise = requestAppTicket();
					}
				}

				return promise
					.then(function(ticket) {
						return requestWithTicket(method, path, data, config, ticket);
					});

			};



		}



		return service;

	}];

});
