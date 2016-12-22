var fs = require('fs'),
JSONStream = require('JSONStream'),
path = require('path'),
querystring = require('querystring');
http = require('http');

//some testing stuff
/*var stream = fs.createReadStream(path.resolve(__dirname, 'AllSets.json'), {encoding: 'utf8'}),
	//parser = JSONStream.parse("*.cards.[?(@.name=='Armageddon')]");
	//parser = JSONStream.parse("*.cards.*.name");
	parser = JSONStream.parse([true, 'cards', true, 'name']);
	
stream.pipe(parser).on('data', function(data) {
	if (data == 'Armageddon') {
		console.log('received:', data);
		stream.destroy();
	}
});*/

//stream.on('start', function(data) { console.log('started', data);});
/*stream.on('data', function(data) {
	console.log('received:', data);
});*/


function getPrice(cardName, callback, tryHarder) {
	var sanitizedName = querystring.stringify({"Product Name": cardName });
	
	if (tryHarder == null) {
		p = '/magic/product/show?' + sanitizedName + '&newSearch=false&IsProductNameExact=true';
	} else {
		p = '/productcatalog/product/show?newSearch=false&ProductType=All&IsProductNameExact=false&' + sanitizedName
	}
	
	var options = {
		host: 'shop.tcgplayer.com',
		port: 80,
		path: p
	};

	http.get(options, function(res) {
		var body = '';
		res.on('data', function(chunk) {
			body += chunk;
		});
			
		res.on('end', function(chunk) {
			var startPos = 0;
			var lowestPrice = 99999;
			var linkToLowest = '';
			
			if (body.indexOf('div class=\"imageContainer"', startPos) == -1) {
				if (!tryHarder) {
					getPrice(cardName, callback, true);
					return;
				}
			}
			
			while (body.indexOf('div class=\"imageContainer"', startPos) > startPos) {
				var imgLink = body.indexOf('div class=\"imageContainer"', startPos);
				var marketPriceSpan = body.indexOf('div class=\"scCardContent"', imgLink);
				var startPrice = body.indexOf('<span style="float: right;">', marketPriceSpan) + 29;
				var endPrice = body.indexOf('</span>', startPrice);
				if (endPrice > startPos) {
					startPos = endPrice;
				} else {
					break;
				}
				
				var strPrice = body.substr(startPrice, endPrice - startPrice);
				
				if (strPrice.indexOf('/A') > -1) {
					continue;
				}
				var price = parseFloat(strPrice);
				if (price < lowestPrice) {
					lowestPrice = price;
					linkToLowest = imgLink;
				}
				
			}
			if (lowestPrice == 99999) {
				lowestPrice = ''
			}
			
			//get the foil price now
			var actualLinkStart = body.indexOf("a href=\"", linkToLowest) + 8;
			var actualLinkEnd = body.indexOf("\">", actualLinkStart);
			var actualLink = body.substr(actualLinkStart, actualLinkEnd - actualLinkStart);
			
			options = {
				host: 'shop.tcgplayer.com',
				port: 80,
				path: actualLink
			};
			
			http.get(options, function(res) {
				var cardBody = '';
				res.on('data', function(chunk) {
					cardBody += chunk;
				});
				res.on('end', function(chunk) {
					var foilPrice = '';
					var setTD = cardBody.indexOf("<b>Set Name:</b>");
					var setAnchor = cardBody.indexOf("a href=", setTD);
					var startSet = cardBody.indexOf(">", setAnchor) + 1;
					var endSet = cardBody.indexOf("/a", startSet) - 1;
					var setText = cardBody.substr(startSet, endSet - startSet);
					
					setText = setText.replace("9th", "Ninth");
					setText = setText.replace("8th", "Eighth");
					setText = setText.replace("7th", "Seventh");
					
					var marketPriceTD = cardBody.indexOf(">Market Price</td>", setTD);
					var foilTD = cardBody.indexOf("Foil", marketPriceTD);
					var endOfMarketPriceTd = cardBody.indexOf("</table>", marketPriceTD);
					
					//if no foil price was found
					if (endOfMarketPriceTd < foilTD) {
						callback('$' + lowestPrice, setText);
						return;
					}
					
					var startFoilPrice = cardBody.indexOf("$", foilTD);
					var startNAPrice = cardBody.indexOf("N/A", foilTD);
					var endFoilPrice = cardBody.indexOf("</td>", startFoilPrice);
					
					if (startNAPrice < startFoilPrice && startNAPrice > -1) {
						startFoilPrice = startNAPrice;
						endFoilPrice = cardBody.indexOf("</td>", startFoilPrice);
					}
					foilPrice = cardBody.substr(startFoilPrice, endFoilPrice - startFoilPrice);

					
					callback("$" + lowestPrice + " (Foil: " + foilPrice + ")", setText);
				});
			}).on('error', function(e){
				console.log('error', e);
			});
			
		});
	}).on('error', function(e){
		console.log('error', e);
	});
}