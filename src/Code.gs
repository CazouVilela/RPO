function onOpen(e) {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Abrir Sidebar', 'showSidebar')
    .addItem('Abrir Painel', 'showDialog')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('RPO');
  SpreadsheetApp.getUi().showSidebar(html);
}

function showDialog() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setWidth(700)
    .setHeight(500);
  SpreadsheetApp.getUi().showModelessDialog(html, 'RPO');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
