chrome.browserAction.onClicked.addListener(function(tab) {
	var optionsUrl = chrome.extension.getURL('window.html');
	chrome.tabs.query({url: optionsUrl}, function(tabs) {
	    if (tabs.length) {
	        chrome.tabs.update(tabs[0].id, {active: true});
	    } else {
	        chrome.tabs.create({url: optionsUrl});
	    }
	});
});

var activeElement;
var moveItemPositionHandler = function(element){
	return function(){
		if (element	== activeElement){
			$( "#move-popup" ).hide();
			activeElement = null;
		}	
		else {
			activeElement = element;
			$( "#move-popup" ).show().position({
				my: "left bottom",
				at: "left top",
				collision: "none fit",
				of: element
			});
		}
	}
}

ko.bindingHandlers.moveItem = {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        // This will be called when the binding is first applied to an element
        // Set up any initial state, event handlers, etc. here
		$(element).bind("click", moveItemPositionHandler(element));
    },
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        // This will be called once when the binding is first applied to an element,
        // and again whenever any observables/computeds that are accessed change
        // Update the DOM element based on the supplied values here.
		//$(element).bind("click", moveItemPositionHandler(element));
    }
};

var filterItemByType = function(type, isEquipped){
	return function(weapon){
		if (weapon.bucketType == type && weapon.isEquipped() == isEquipped)
			return weapon;
	}
}

var Profile = function(model){
	var self = this;
	_.each(model, function(value, key){
		self[key] = value;
	});
	
	this.weapons = ko.observableArray([]);
	this.armor = ko.observableArray([]);
	this.items = ko.observableArray([]);
	
	this.get = function(list, type){
		return self[list]().filter(filterItemByType(type, false));
	}
	this.itemEquipped = function(list, type){
		return ko.utils.arrayFirst(self[list](), filterItemByType(type, true));
	}
}

var Item = function(stats, profile){
	var self = this;
	Object.keys(stats).forEach(function(key){
		self[key] = stats[key];
	});
	this.character = profile;
	this.isEquipped = ko.observable(self.isEquipped);
	this.moveItem = function(){
		app.activeItem(self);
	}
	this.equip = function(list, targetCharacterId){
		var sourceCharacterId = self.characterId;
		if (targetCharacterId == sourceCharacterId){
			app.bungie.equip(targetCharacterId, self._id, function(e, result){
				if (result.Message == "Ok"){
					self.isEquipped(true);
					self.character[list]().forEach(function(item){
						if (item != self && item.bucketType == self.bucketType){
							item.isEquipped(false);
						}
					});
				}
				else {
					alert(result.Message);
				}
			});
		}
		else {
			self.store(list, targetCharacterId, function(newProfile){
				self.character = newProfile;
				self.equip(list, targetCharacterId);
				window.item = self;
			});
		}
	}
	this.transfer = function(list, sourceCharacterId, targetCharacterId, cb){
		var isVault = targetCharacterId == "Vault";
		app.bungie.transfer(isVault ? sourceCharacterId : targetCharacterId, self._id, self.id, 1, isVault, function(e, result){
			if (result.Message == "Ok"){
				ko.utils.arrayFirst(app.characters(), function(character){
					if (character.id == sourceCharacterId){
						character[list].remove(self);
					}
					else if (character.id == targetCharacterId){
						self.characterId = targetCharacterId;
						character[list].push(self);
						if (cb) cb(character);
					}
				});				
			}
			else {
				alert(result.Message);
			}
		});
	}
	this.store = function(list, targetCharacterId, callback){
		var sourceCharacterId = self.characterId;
		if (targetCharacterId == "Vault"){
			//console.log("from charcter to vault");
			self.transfer(list, sourceCharacterId, "Vault", callback);
		}
		else if (sourceCharacterId !== "Vault"){
			//console.log("from character to vault to character");
			self.transfer(list, sourceCharacterId, "Vault", function(){
				self.transfer(list, "Vault", targetCharacterId, callback);
			});
		}
		else {
			//console.log("from vault to character");
			self.transfer(list, "Vault", targetCharacterId, callback);
		}
	}
}

var DestinyGender = {
	"0": "Male",
	"1": "Female",
	"2": "Unknown"
};
var DestinyClass = {
    "0": "Titan",
    "1": "Hunter",
    "2": "Warlock",
    "3": "Unknown"
};
var DestinyDamageTypes = {
    "0": "None",
    "1": "Kinetic",
    "2": "Arc",
    "3": "Solar",
    "4": "Void",
    "5": "Raid"
};
var DestinyBucketTypes = {
	"1498876634": "Primary",
	"2465295065": "Special",
	"953998645": "Heavy",
	"3448274439": "Helmet",
	"3551918588": "Gauntlet",
	"14239492": "Chest",
	"20886954": "Boots",
	"2973005342": "Shader",
	"4274335291": "Emblem",
	"2025709351": "Sparrow",
	"284967655": "Ship"
}

var app = new (function() {
	var self = this;

	this.activeItem = ko.observable();
	this.activeUser = ko.observable();
	this.characters = ko.observableArray();
	this.orderedCharacters = ko.computed(function(){
		return self.characters().sort(function(a,b){
			return a.order - b.order;
		});
	});
	
	var processItem = function(profile, itemDefs, perkDefs){	
		return function(item){
			var info = itemDefs[item.itemHash];
			var itemObject = new Item({ 
				id: item.itemHash,
				_id: item.itemInstanceId,
				characterId: profile.id,
				damageType: item.damageType,
				damageTypeName: DestinyDamageTypes[item.damageType],
				description: info.itemName, 
				bucketType: DestinyBucketTypes[info.bucketTypeHash],
				type: info.itemSubType, //12 (Sniper)
				typeName: info.itemTypeName, //Sniper Rifle
				tierType: info.tierType, //6 (Exotic) 5 (Legendary)
				icon: "http://www.bungie.net/" + info.icon,
				isEquipped: item.isEquipped,
				isGridComplete: item.isGridComplete
			}, profile);
			if (item.primaryStat)
				itemObject.primaryStat = item.primaryStat.value;
			
			if (info.itemType === 3){
				itemObject.perks = item.perks.map(function(perk){
					var p = perkDefs[perk.perkHash];
					return {
						name: p.displayName,
						description: p.displayDescription
					}
				});
				profile.weapons.push( itemObject );
			}
			else if (info.itemType == 2){
				profile.armor.push( itemObject );
			}
			else if (info.bucketTypeHash in DestinyBucketTypes){
				profile.items.push( itemObject );
			}
		}
	}
	
	this.loadData = function(){
		self.bungie.user(function(user){
			self.activeUser(user);
			self.bungie.search(function(e){
				var avatars = e.data.characters;
				self.bungie.vault(function(results){
					var buckets = results.data.buckets;
					var profile = new Profile({ order: 0, gender: "Tower",  classType: "Vault", id: "Vault", level: "", icon: "", background: "" });
					var def = results.definitions.items;
					var def_perks = results.definitions.perks;
					
					buckets.forEach(function(bucket){
						bucket.items.forEach(processItem(profile, def, def_perks));
					});
					
					self.characters.push(profile);
				});
				avatars.forEach(function(character, index){
					self.bungie.inventory(character.characterBase.characterId, function(response) {
						var profile = new Profile({
							order: index+1,
							gender: DestinyGender[character.characterBase.genderType],
							classType: DestinyClass[character.characterBase.classType],
							id: character.characterBase.characterId,
							icon: "url(http://www.bungie.net/" + character.emblemPath + ")",
							background: "url(http://www.bungie.net/" + character.backgroundPath + ")",
							level: character.characterLevel
						});
						var items = [];						
						response.data.buckets.Equippable.forEach(function(obj){
							obj.items.forEach(function(item){
								items.push(item);
							});
						});
						var def = response.definitions.items;
						var def_perks = response.definitions.perks;
						items.forEach(processItem(profile, def, def_perks));
						self.characters.push(profile);
					});
				});
			});			
		});
	}
	
	this.init = function(){
		self.bungie = new bungie();
		self.loadData();
		ko.applyBindings(self, document.getElementById('itemsList'));
	}
});

$(document).ready(app.init);