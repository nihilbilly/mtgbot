var fs = require('fs'),
http = require('http'),
Slack = require('slack-node'),
Client = require('websocket').client,
Index = require('node-index');

var slack = new Slack("xoxb-34044266993-5Nnr2MuFUBS5JwGaPxLwK67i"),
client = new Client(),
index = new Index(),
userId = null;

console.log('Fetching list of card names...');

http.get('http://api.mtgapi.com/v2/names', function(res) {
	var output = '';
	
	res.on('data', function (chunk) {
		output += chunk;
	});
	
	res.on('end', function() {
		var names = JSON.parse(output).names;
		
		console.log('Indexing card names...');
		
		for (id in names) {
			index.addDocument(id, {name: names[id]});
		}
		
		console.log('Ready for requests...');
		
		client.on('connectFailed', function(error) {
			console.log('error connecting', error);
		});
		
		client.on('connect', function(connection) {
			connection.on('message', function(message) {
				
				data = JSON.parse(message.utf8Data);
				//console.log(data);
				if (data.user != userId && data.type == 'message') {
					if (!data.text){
						return;
					}
					var attachments = [];
					var bestMatches = [];
					var cardMatches = [];
					var totalRequests = 0;
					for (i = data.text.indexOf("["); i >= 0; i = data.text.indexOf("[", i + 1)) {
						cardMatches.push(data.text.substring(i + 1, data.text.indexOf("]", i)));
					}
					if (!cardMatches.length && data.user === 'bmp' && data.text.indexOf("soup") >= 0) {
						slack.api("chat.postMessage", {channel: channel, as_user: true, text: ':stew:'}, function() {});
						return;
					}
					//console.log("cardMatches: ", cardMatches);
					for (i in cardMatches){
						var indexMatches = index.query(cardMatches[i]),
						target = cardMatches[i].toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
						var match = null;
						
						//console.log("indexMatches: ", indexMatches)
						for (j in indexMatches) {
							
							var test = indexMatches[j].doc.name.toLowerCase().replace(/[^ \w]/g, ' ').replace(/ +/g, ' ');
							//console.log(indexMatches[j]);
							
							if (target.indexOf(test) >= 0 && (!match || indexMatches[j].doc.name.length > match.doc.name.length)) {
								match = indexMatches[j];
							}
						}
						if (match) {
							bestMatches.push(match);
						}
					}
					
					totalRequests = bestMatches.length;
					//console.log("bestMatches: ", bestMatches);
					for (var i in bestMatches) {
						(function(index, channel) {
							http.get('http://api.mtgapi.com/v2/cards?name='+bestMatches[index].doc.name, function(res) {
								var output = '';
								//console.log("bestMatch in get: ", bestMatches[index], index);
								
								res.on('data', function (chunk) {
									output += chunk;
								});
								
								res.on('end', function() {
									var card = JSON.parse(output).cards[0];
									//sometimes the id is 0 so we get a bad link. weird.
									if (card.multiverseid === 0){
										card = JSON.parse(output).cards[1];
									}
									//console.log(card);
									attachments.push({
										title: bestMatches[index].doc.name,
										title_link: 'http://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid='+card.multiverseid,
										image_url: card.images.gatherer
									});
									//console.log("attachments: ", attachments);
									//console.log(index, totalRequests);
									totalRequests--;
									if (totalRequests <= 0){
										var JSONattachments = JSON.stringify(attachments);
										slack.api("chat.postMessage", {channel: channel, as_user: true, text: ' ', attachments: JSONattachments}, function() {});
									}
								});
								
								
							});
						})(i, data.channel);
					}
					
				}
				
				
			});
		});
		
		slack.api("rtm.start", function(err, response) {
			userId = response.self.id;
			client.connect(response.url);
		});
	});
});

