'use strict';
// Точка входа chaincode: Fabric загружает контракты из массива contracts.
const TrafficContract = require('./lib/trafficContract');
module.exports.contracts = [TrafficContract];
