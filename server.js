var fs = require('fs'),
Slack = require('slack-node'),
Client = require('websocket').client,
//path = require('path'),
//markov = require('markov'),
https = require('https');

//cheap easy way to load in our pricing utils
eval(fs.readFileSync('mtgbot-master/priceutil.js')+'');

process.on('uncaughtException', function (err) {
	console.log('Uncaught exception: ', err);
});

var slack = new Slack(""),
client = new Client(),
userId = null;

client.on('connectFailed', function(error) {
	console.error('error connecting', error);
});

client.on('connect', function(connection) {
	connection.on('error', function(error) {
		console.error('Connection error: ', error);
	});
	
	connection.on('close', function(reasonCode, description) {
		console.log('Connection closed', reasonCode, description);
		console.log('Attempting reconnect');
		startAPI();
	});
	
	connection.on('message', function(message) {
		var data = JSON.parse(message.utf8Data);	
		if (data.user != userId && data.type == 'message') {
			if (!data.text){
				return;
			}
			var attachments = [], bestMatches = [], cardMatches = [];
			
			// replace [[double brackets]] with [single brackets] if someones too used to reddit
			// also replace fancy quotes
			var text = data.text.replace(/(\[){2,}/, "[").replace(/(\]){2,}/, "]").replace('’','\'');
			
			
			// look for [card names] in brackets
			for (var i = text.indexOf("["); i >= 0; i = text.indexOf("[", i + 1)) {
				cardMatches.push(text.substring(i + 1, text.indexOf("]", i)));
			}
			
			var totalRequests = cardMatches.length;
			var done = function() {
				if (totalRequests <= 0) {
					var JSONattachments = JSON.stringify(attachments);
					slack.api("chat.postMessage", {channel: data.channel, as_user: true, text: ' ', attachments: JSONattachments}, function() {});
				}
			};
			
			// find cards in on scryfall
			for (i in cardMatches){
				var p = '/cards/named?exact=' + encodeURIComponent(cardMatches[i]) + '&format=json';
				var options = {
					host: 'api.scryfall.com',
					port: 443,
					path: p
				};
				
				https.get(options, function(res) {
					var body = '';
					res.on('data', function(chunk) {
						body += chunk;
					});
					res.on('end', function(chunk) {
						var card = JSON.parse(body);
						
						var doneGettingPrice = function(priceText) {
							attachments.push({
								title: card.name + ' [' + card.set_name + '] ' + priceText,
								title_link: card.related_uris.gatherer,
								image_url: 'http://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=' + card.multiverse_id + '&type=card'
							});
							totalRequests--;
							done();
						};
						
						getPriceWithScryfallLink(card.purchase_uris.tcgplayer, doneGettingPrice);
					});
				});
			}
		}		
	});
});

function startAPI() {
	slack.api("rtm.start", function(err, response) {
		if (err){
			console.log("Error starting slack bot: ", err);
		}
		userId = response.self.id;
		var url = response.url;
		client.connect(url);
		
		console.log('Ready for requests...');
	});
}

startAPI();