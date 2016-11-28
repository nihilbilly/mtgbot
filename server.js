var fs = require('fs'),
http = require('http'),
Slack = require('slack-node'),
Client = require('websocket').client,
Hashmap = require('hashmap'),
path = require('path'),
markov = require('markov');

//cheap easy way to load in our pricing utils
eval(fs.readFileSync('mtgbot-master/priceutil.js')+'');

process.on('uncaughtException', function (err) {
	console.log('Uncaught exception: ', err);
});

var slack = new Slack("REDACTED"),
client = new Client(),
map = new Hashmap(),
userId = null,
url = null;

console.log('Fetching list of card names...');

// Allsets.json pulled from http://mtgjson.com/ required to work!
// TODO: add feature to download, extract and re-index allsets.json by command
var sets = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'AllSets.json'), 'utf8'));

console.log('Indexing card names...');

// add each card in every set to our index
for (var s in sets) {
	var set = sets[s];
	for (var c in set.cards) {

		var card = set.cards[c];
		if (card.multiverseid !== undefined){
			map.set(card.multiverseid.toString(), card.name);
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
		console.log('Connection closed. ', reasonCode, description);
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
			var text = data.text.replace(/(\[){2,}/, "[").replace(/(\]){2,}/, "]");
			
			// look for [card names] in brackets
			for (var i = text.indexOf("["); i >= 0; i = text.indexOf("[", i + 1)) {
				cardMatches.push(text.substring(i + 1, text.indexOf("]", i)));
			}
			
			// find cards in our index
			for (i in cardMatches){
				var indexMatches = [];
				
				for (var key in map._data) {
					if (map._data[key][1].toLowerCase() === cardMatches[i].toLowerCase()) {
						indexMatches.push(map.search(map._data[key][1]));
					}
				}
				
				var target = cardMatches[i].toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
				var match = null;
				
				for (var j in indexMatches) {
					var indexMatch = map.get(indexMatches[j]);
					var test = indexMatch.toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
					
					// if our [card] contains the full text of a card in our index, we got a match
					//	try to find the most correct match by keeping the longest [card name] that matches our index
					if (target.indexOf(test) >= 0 && (!match || indexMatch.length > match.length)) {
						match = indexMatches[j];
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
					var name = map.get(bestMatches[index]);
					var multiverseID = bestMatches[index];
					
					var callback = function(price) {
						attachments.push({
							title: name + ' ' + price,
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