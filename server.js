var fs = require('fs'),
http = require('http'),
Slack = require('slack-node'),
Client = require('websocket').client,
path = require('path'),
markov = require('markov');

//cheap easy way to load in our pricing utils
eval(fs.readFileSync('mtgbot-master/priceutil.js')+'');

process.on('uncaughtException', function (err) {
	console.log('Uncaught exception: ', err);
});

var slack = new Slack(""),
client = new Client(),
userId = null,
url = null,
map = new Array();

console.log('Fetching list of card names...');

// Allsets.json pulled from http://mtgjson.com/ required to work!
// TODO: add feature to download, extract and re-index allsets.json by command
var sets = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'AllSets.json'), 'utf8'));

console.log('Indexing card names...');

// add each card in every set to our index
for (var s in sets) {
	var set = sets[s];
	var setName = set.name;

	for (var c in set.cards) {

		var card = set.cards[c];
		if (card.multiverseid !== undefined){
			map.push({ multiverseID: card.multiverseid.toString(), name: card.name, setName: setName });
		}
	}
}

sets = null;

console.log('Ready for requests...');

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
			
			// find cards in our index
			for (i in cardMatches){
				var indexMatches = [];
				
				for (var key in Object.keys(map)) {
					var cardName = map[key].name.toLowerCase();
					if (cardName === cardMatches[i].toLowerCase()) {
						indexMatches.push(map[key]);
					}
				}
				
				var target = cardMatches[i].toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
				var match = new Array();
				var sets = new Array();
				
				for (var j in indexMatches) {
					var indexMatch = indexMatches[j];
					var test = indexMatch.name.toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
					
					if (target.indexOf(test) >= 0 && match.length == 0) {
						sets.push({ setName: indexMatches[j].setName, multiverseID: indexMatches[j].multiverseID });
						match.push({ name: indexMatches[j].name, sets: sets });
					} else if (match) {
						match[0].sets.push({ setName: indexMatches[j].setName, multiverseID: indexMatches[j].multiverseID });
					}
				}
				if (match) {
					bestMatches.push(match);
				}
			}
			
			var totalRequests = bestMatches.length;
			// create image attachment using gatherer image for each card we found and post a message
			for (i in bestMatches) {
				(function(index, channel) {					
					var name = bestMatches[index][0].name;
					var multiverseID = '';
					
					var callback = function(price, setName) {
						for (var j in bestMatches[index][0].sets) {
							if (bestMatches[index][0].sets[j].setName === setName) {
								multiverseID = bestMatches[index][0].sets[j].multiverseID;
							}
						}
						
						attachments.push({
							title: name + ' [' + setName + '] ' + price,
							title_link: 'http://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=' + multiverseID,
							image_url: 'http://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=' + multiverseID + '&type=card'
						});

						totalRequests--;
						if (totalRequests <= 0){
							var JSONattachments = JSON.stringify(attachments);
							slack.api("chat.postMessage", {channel: channel, as_user: true, text: ' ', attachments: JSONattachments}, function() {});
						}
					}
					
					//getPrice found in priceutil.js
					getPrice(name, callback);					
				})(i, data.channel);
			}
			
			//all right babies, lets do some markov shit!
			if (!cardMatches.length && data.text.toLowerCase().indexOf('mimic') >= 0) {
				if (data.text.indexOf('<@U') >= 0) {
					//generate a markov chain between 20 and 12 links long
					var m = markov(Math.floor(Math.random() * (20 - 12) + 12));
					var user = data.text.substring(data.text.indexOf('<@U') + 2, data.text.indexOf('>'));
					var s = fs.readFileSync(path.resolve(process.env.HOME, 'httpdocs/bmklogs/' + user + '.txt'), 'utf8');
					m.seed(s, function() {
						var res = m.pick();
						if (res)
							slack.api("chat.postMessage", {channel: data.channel, as_user: true, text: res.split('_').join(' ') });
					});
				}
			} // some logging for the mimic command.
			/*else if (!cardMatches.length && data.text.toLowerCase().indexOf('mimic') < 0) {
				if (data.type === 'message' && !data.subtype) {
					var ws = fs.createWriteStream(path.resolve(process.env.HOME, 'httpdocs/bmklogs/' + data.user + '.txt'), {'flags': 'a'});
					ws.write(data.text);
					ws.end();
				}
			}*/
		}		
	});
});

function startAPI() {
	slack.api("rtm.start", function(err, response) {
		if (err){
			console.log("Error starting slack bot: ", err);
		}
		userId = response.self.id;
		url = response.url;
		client.connect(url);
	});
}

startAPI();