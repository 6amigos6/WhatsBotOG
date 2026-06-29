require('dotenv').config();

const settings = {
  packname: 'ORUJOV',
  author: '‎',
  botName: "ORUJOV",
  botOwner: 'ORUJOV',
  ownerNumber: process.env.OWNER_NUMBER || '994501234567',
  giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: "public",
  maxStoreMessages: 20,
  storeWriteInterval: 10000,
  description: "This is a bot for managing group commands and automating tasks.",
  version: "3.0.7",
  updateZipUrl: "https://github.com/Anony1010/WhatsbotOG/archive/refs/heads/main.zip",
  telegramToken: '8940118138:AAGQkIDoymDcWVmd9SFsQo7LYxXzmp6WTKo',
  pairNumber: process.env.PAIR_NUMBER || '',
};

module.exports = settings;
