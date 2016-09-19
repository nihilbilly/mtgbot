var fs = require('fs'),
http = require('http'),
Slack = require('slack-node'),
Client = require('websocket').client,
//Index = require('node-index'),
Hashmap = require('hashmap'),
//JSONStream = require('JSONStream'),
path = require('path');

process.on('uncaughtException', function (err) {
	console.log('Uncaught exception: ', err);
});

var slack = new Slack("REDACTED"),
client = new Client(),
//index = new Index(),
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
			//index.addDocument(card.id, { name: card.name, multiverseid: card.multiverseid.toString() });
		}
	}
}

sets = null;

// TODO: add code to stream the extended file to read in flavor text on a per-request basis 
// so we dont have to keep flavor text in memory (its a lot of data)
/*var stream = fs.createReadStream(path.resolve(__dirname, 'AllSets.json'), {encoding: 'utf8'}),
	parser = JSONStream.parse("*.cards[?(@.name=='Armageddon')]");
	stream.pipe(parser);

parser.on('data', function(data) {
	console.log('received:', data);
});

return;*/

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
			
			// some fun with pete
			if (!cardMatches.length && data.user == 'U0HP4K8D7' && text.indexOf("soup") >= 0) {
				slack.api("chat.postMessage", {channel: data.channel, as_user: true, text: ':stew:'}, function() {});
				return;
			}

			// does someone want oracle text?
			//if (text.contains(')
			
			// find cards in our index
			for (i in cardMatches){
				//var indexMatches = index.query(cardMatches[i]);
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
					var output = '';
					
					var name = map.get(bestMatches[index]);
					var multiverseID = bestMatches[index];
					
					attachments.push({
						title: name,
						title_link: 'http://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=' + multiverseID,
						image_url: 'http://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=' + multiverseID + '&type=card'
					});

					totalRequests--;
					if (totalRequests <= 0){
						var JSONattachments = JSON.stringify(attachments);
						slack.api("chat.postMessage", {channel: channel, as_user: true, text: ' ', attachments: JSONattachments}, function() {});
					}
				})(i, data.channel);
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
		url = response.url;
		client.connect(url);
	});
}

startAPI();