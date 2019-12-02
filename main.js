/*import {FuzzySet} from "./fuzzyset.js";*/
var FuzzySet = function (arr, useLevenshtein, gramSizeLower, gramSizeUpper) {
    var fuzzyset = {

    };

    // default options
    arr = arr || [];
    fuzzyset.gramSizeLower = gramSizeLower || 2;
    fuzzyset.gramSizeUpper = gramSizeUpper || 3;
    fuzzyset.useLevenshtein = (typeof useLevenshtein !== 'boolean') ? true : useLevenshtein;

    // define all the object functions and attributes
    fuzzyset.exactSet = {};
    fuzzyset.matchDict = {};
    fuzzyset.items = {};

    // helper functions
    var levenshtein = function (str1, str2) {
        var current = [], prev, value;

        for (var i = 0; i <= str2.length; i++)
            for (var j = 0; j <= str1.length; j++) {
                if (i && j)
                    if (str1.charAt(j - 1) === str2.charAt(i - 1))
                        value = prev;
                    else
                        value = Math.min(current[j], current[j - 1], prev) + 1;
                else
                    value = i + j;

                prev = current[j];
                current[j] = value;
            }

        return current.pop();
    };

    // return an edit distance from 0 to 1
    var _distance = function (str1, str2) {
        if (str1 === null && str2 === null) throw 'Trying to compare two null values';
        if (str1 === null || str2 === null) return 0;
        str1 = String(str1); str2 = String(str2);

        var distance = levenshtein(str1, str2);
        if (str1.length > str2.length) {
            return 1 - distance / str1.length;
        } else {
            return 1 - distance / str2.length;
        }
    };
    var _nonWordRe = /[^a-zA-Z0-9\u00C0-\u00FF, ]+/g;

    var _iterateGrams = function (value, gramSize) {
        gramSize = gramSize || 2;
        var simplified = '-' + value.toLowerCase().replace(_nonWordRe, '') + '-',
            lenDiff = gramSize - simplified.length,
            results = [];
        if (lenDiff > 0) {
            for (var i = 0; i < lenDiff; ++i) {
                simplified += '-';
            }
        }
        for (var i = 0; i < simplified.length - gramSize + 1; ++i) {
            results.push(simplified.slice(i, i + gramSize));
        }
        return results;
    };

    var _gramCounter = function (value, gramSize) {
        // return an object where key=gram, value=number of occurrences
        gramSize = gramSize || 2;
        var result = {},
            grams = _iterateGrams(value, gramSize),
            i = 0;
        for (i; i < grams.length; ++i) {
            if (grams[i] in result) {
                result[grams[i]] += 1;
            } else {
                result[grams[i]] = 1;
            }
        }
        return result;
    };

    // the main functions
    fuzzyset.get = function (value, defaultValue, minMatchScore) {
        // check for value in set, returning defaultValue or null if none found
        if (minMatchScore === undefined) {
            minMatchScore = .33
        }
        var result = this._get(value, minMatchScore);
        if (!result && typeof defaultValue !== 'undefined') {
            return defaultValue;
        }
        return result;
    };

    fuzzyset._get = function (value, minMatchScore) {
        var normalizedValue = this._normalizeStr(value),
            result = this.exactSet[normalizedValue];
        if (result) {
            return [[1, result]];
        }

        var results = [];
        // start with high gram size and if there are no results, go to lower gram sizes
        for (var gramSize = this.gramSizeUpper; gramSize >= this.gramSizeLower; --gramSize) {
            results = this.__get(value, gramSize, minMatchScore);
            if (results && results.length > 0) {
                return results;
            }
        }
        return null;
    };

    fuzzyset.__get = function (value, gramSize, minMatchScore) {
        var normalizedValue = this._normalizeStr(value),
            matches = {},
            gramCounts = _gramCounter(normalizedValue, gramSize),
            items = this.items[gramSize],
            sumOfSquareGramCounts = 0,
            gram,
            gramCount,
            i,
            index,
            otherGramCount;

        for (gram in gramCounts) {
            gramCount = gramCounts[gram];
            sumOfSquareGramCounts += Math.pow(gramCount, 2);
            if (gram in this.matchDict) {
                for (i = 0; i < this.matchDict[gram].length; ++i) {
                    index = this.matchDict[gram][i][0];
                    otherGramCount = this.matchDict[gram][i][1];
                    if (index in matches) {
                        matches[index] += gramCount * otherGramCount;
                    } else {
                        matches[index] = gramCount * otherGramCount;
                    }
                }
            }
        }

        function isEmptyObject(obj) {
            for (var prop in obj) {
                if (obj.hasOwnProperty(prop))
                    return false;
            }
            return true;
        }

        if (isEmptyObject(matches)) {
            return null;
        }

        var vectorNormal = Math.sqrt(sumOfSquareGramCounts),
            results = [],
            matchScore;
        // build a results list of [score, str]
        for (var matchIndex in matches) {
            matchScore = matches[matchIndex];
            results.push([matchScore / (vectorNormal * items[matchIndex][0]), items[matchIndex][1]]);
        }
        var sortDescending = function (a, b) {
            if (a[0] < b[0]) {
                return 1;
            } else if (a[0] > b[0]) {
                return -1;
            } else {
                return 0;
            }
        };
        results.sort(sortDescending);
        if (this.useLevenshtein) {
            var newResults = [],
                endIndex = Math.min(50, results.length);
            // truncate somewhat arbitrarily to 50
            for (var i = 0; i < endIndex; ++i) {
                newResults.push([_distance(results[i][1], normalizedValue), results[i][1]]);
            }
            results = newResults;
            results.sort(sortDescending);
        }
        var newResults = [];
        results.forEach(function (scoreWordPair) {
            if (scoreWordPair[0] >= minMatchScore) {
                newResults.push([scoreWordPair[0], this.exactSet[scoreWordPair[1]]]);
            }
        }.bind(this))
        return newResults;
    };

    fuzzyset.add = function (value) {
        var normalizedValue = this._normalizeStr(value);
        if (normalizedValue in this.exactSet) {
            return false;
        }

        var i = this.gramSizeLower;
        for (i; i < this.gramSizeUpper + 1; ++i) {
            this._add(value, i);
        }
    };

    fuzzyset._add = function (value, gramSize) {
        var normalizedValue = this._normalizeStr(value),
            items = this.items[gramSize] || [],
            index = items.length;

        items.push(0);
        var gramCounts = _gramCounter(normalizedValue, gramSize),
            sumOfSquareGramCounts = 0,
            gram, gramCount;
        for (gram in gramCounts) {
            gramCount = gramCounts[gram];
            sumOfSquareGramCounts += Math.pow(gramCount, 2);
            if (gram in this.matchDict) {
                this.matchDict[gram].push([index, gramCount]);
            } else {
                this.matchDict[gram] = [[index, gramCount]];
            }
        }
        var vectorNormal = Math.sqrt(sumOfSquareGramCounts);
        items[index] = [vectorNormal, normalizedValue];
        this.items[gramSize] = items;
        this.exactSet[normalizedValue] = value;
    };

    fuzzyset._normalizeStr = function (str) {
        if (Object.prototype.toString.call(str) !== '[object String]') throw 'Must use a string as argument to FuzzySet functions';
        return str.toLowerCase();
    };

    // return length of items in set
    fuzzyset.length = function () {
        var count = 0,
            prop;
        for (prop in this.exactSet) {
            if (this.exactSet.hasOwnProperty(prop)) {
                count += 1;
            }
        }
        return count;
    };

    // return is set is empty
    fuzzyset.isEmpty = function () {
        for (var prop in this.exactSet) {
            if (this.exactSet.hasOwnProperty(prop)) {
                return false;
            }
        }
        return true;
    };

    // return list of values loaded into set
    fuzzyset.values = function () {
        var values = [],
            prop;
        for (prop in this.exactSet) {
            if (this.exactSet.hasOwnProperty(prop)) {
                values.push(this.exactSet[prop]);
            }
        }
        return values;
    };


    // initialization
    var i = fuzzyset.gramSizeLower;
    for (i; i < fuzzyset.gramSizeUpper + 1; ++i) {
        fuzzyset.items[i] = [];
    }
    // add all the items to the set
    for (i = 0; i < arr.length; ++i) {
        fuzzyset.add(arr[i]);
    }

    return fuzzyset;
};

class Guess {
    constructor(length) {
        this.fitness = -1;
        this.string = Math.random().toString(36).substring(4, 4 + length)
    }
}
String.prototype.replaceAt = function (index, replacement) {
    return this.substr(0, index) + replacement + this.substr(index + replacement.length);
}
function InitPopulation() {
    population = new Array();
    for (let i = 0; i < populationSize; i++) {
        population.push(new Guess(stringLength));
    }
    return population
}
function updateTarget(value) {
    targetString = value;
    target = FuzzySet([targetString]);
    if (stringLength != value.length) {
        stringLength = value.length;
        InitPopulation();
    }
}
function updateView() {
    let best = population[0].string;
    var best_str = "<td>";
    for (let i = 0; i < best.length; i++) {
        if (best[i] === targetString[i]) {
            best_str += '<span style="color:green;">' + best[i] + '</span>'
        } else {
            best_str += '<span style="color:red;">' + best[i] + '</span>'
        }
    }
    best_str += "</td>";
    document.getElementById("survivors").rows[0].innerHTML = best_str;
    var x = document.getElementById("survivors").rows.length;
    for (i = 1; i < x; i++) {
        document.getElementById("survivors").rows[i].innerHTML = '<td>' + population[i].string + "</td>";
    }
}

function fitness(guess) {
    score = target.get(guess,0,0);
    if (typeof score == 'number'){
        return 0
    } else {
        console.log(target.get(guess,0,0)[0][0])
        return target.get(guess,0,0)[0][0]
    }
}
function cross_select(members) {
    let offspring = [];//new Array();
    new_offspring_count = populationSize - TopN;
    for (let i = 0; i < new_offspring_count / 2; i++) {
        var Parent1 = population[Math.floor(Math.random() * population.length)].string;
        let Parent2 = population[Math.floor(Math.random() * population.length)].string;
        let cut_at = Math.floor(Math.random() * stringLength)

        let Child1 = new Guess();
        Child1.string = Parent1.substring(0, cut_at) + Parent2.substring(cut_at);
        let Child2 = new Guess();
        Child2.string = Parent2.substring(0, cut_at) + Parent1.substring(cut_at);
        offspring.push(Child1, Child2)
    }
    offspring.forEach((item) => { members.push(item) })
    return members
}
function mutate(members) {
    members = members.map((item) => {
        for (i = 0; i < item.string.length; i++) {
            if (Math.random() < mutationRate) {
                item.string = item.string.replaceAt(i, Math.random().toString(36).substring(2, 3));
            }
        }
        return item;
    });
    return members;
}
function Train() {
    if (live) {
        // Calculate and display fitness for the population 
        population.forEach((item) => { item.fitness = fitness(item.string) });
        population.sort(function (a, b) { return b.fitness - a.fitness });
        updateView();
        // Create a new population based on best of previous 
        population = population.slice(0, TopN);
        population = cross_select(population);
        population = mutate(population);
        setTimeout(Train, 500);
    }
}
function startTraining() {
    live = true;
    document.getElementById("toggle").value = "PAUSE TRAINING";
    Train();
}
function toggleTraining() {
    live = !live;
    if (live) {
        document.getElementById("toggle").value = "PAUSE TRAINING";
        Train();
    } else {
        document.getElementById("toggle").value = "RESUME/START TRAINING";
    }
}
let live = false;
let populationSize = 15;
let TopN = 5
let mutationRate = .1;
let targetString = "potato"
let stringLength = 6;
let population;
let target = FuzzySet([targetString]);
InitPopulation();
//population.forEach((item) => {console.log(item.string);});
Train()
