var http = require('http');
var fs = require('fs');
var path = require('path');
var marked = require('marked');

var constants = {
	postsDir: 'posts',
	layoutDir: 'layout',
	headerFile: 'header.html',
	footerFile: 'footer.html',
	readOptions: {encoding:'UTF-8'},
};

var conf = {
	layoutName: 'default',
	postSeparator: "</article>\n<article>\n",
	postsPerPage: 4 
};

var confFromFile = null;

try {
	confFromFile = require('./config.js');
} catch(e) {}

if(confFromFile) {
	mlog('Setting config parameters from config.js');
	for(key in confFromFile.conf) {
		conf[key] = confFromFile.conf[key];
	}
} else {
	mlog('No config.js found');
}

constants.headerFile = path.join(constants.layoutDir, conf.layoutName, constants.headerFile);
constants.footerFile = path.join(constants.layoutDir, conf.layoutName, constants.footerFile);

var rebuilding = false;
var blogStream = [];
var singlePosts = {};

function mlog(what) {
	console.log(new Date().getTime() + "\t" + what);
}

function rebuild() {
	if(rebuilding) return;
	mlog('Rebuilding...');
	rebuilding = true;

	var headerHtml = fs.readFileSync(constants.headerFile, constants.readOptions);
	var footerHtml = fs.readFileSync(constants.footerFile, constants.readOptions);
	var posts = fs.readdirSync(constants.postsDir);
	var postCount = posts.length;

	var pages = Math.ceil(postCount / conf.postsPerPage);
	var page = 0;

	posts.sort(function(a,b){
		return fs.statSync(path.join(constants.postsDir,b)).ctime.getTime() -
			fs.statSync(path.join(constants.postsDir,a)).ctime.getTime();
	});

	mlog('Reading '+postCount+' posts...');
	
	var htmlBlocks = [];
	var postBlocks = [];

	for(var i=0; i<postCount; i++) {
		var postPath = path.join(constants.postsDir, posts[i]);
		var postContent = fs.readFileSync(postPath, constants.readOptions);
		var ctime = fs.statSync(postPath).ctime;
		postContent += "\n\n"+'<a href="/'+posts[i]+'">'+posts[i]+"</a> - "+ctime.toString();
		postContent = marked(postContent);
		postBlocks.push(postContent);

		var singlePostHtmlBlocks = [];
		singlePostHtmlBlocks.push(headerHtml);
		singlePostHtmlBlocks.push(postContent);
		singlePostHtmlBlocks.push(footerHtml);
		singlePostHtmlBlocks.push( '<a href="/">&lt; home</a>' );
		singlePosts[posts[i]] = singlePostHtmlBlocks.join("\n");

		mlog(i+': placing ' +posts[i]+ ' on page '+page+'/'+(pages-1));

		if((page == 0 && i == conf.postsPerPage) || !((i+1)%conf.postsPerPage) || i==(postCount-1)) {
			htmlBlocks.push( headerHtml );
			htmlBlocks.push(postBlocks.join(conf.postSeparator));

			var prevPage = (page+1 > pages-1) ? false : page+1;
			var nextPage = (page-1 < 0) ? false : page-1;
			if(nextPage === 0) nextPage = '';

			if(nextPage !== false) {
				htmlBlocks.push( '<a href="/'+nextPage+'">&lt; newer</a>' );
			}
			if(prevPage !== false) {
				htmlBlocks.push( '<a href="/'+prevPage+'">older &gt;</a>' );
			}
			htmlBlocks.push( footerHtml );

			blogStream[page++] = htmlBlocks.join("\n");
			htmlBlocks = [];
			postBlocks = [];
		}
	}

	rebuilding = false;
	mlog('Done');
}

function out(res, httpStatus, httpOutput) {
	res.writeHead(httpStatus, {'Content-Type': 'text/html'});
 	res.end(httpOutput);
	mlog('Served');
}

function serve(req, res) {
	if(req.url == '/favicon.ico') return;
	mlog('Requested: ' + req.url);
	if(req.url == '/rebuild') {
		rebuild();
	}

	var output = null;

	var postMatch=req.url.match(/\/(\w+\.md)/);
	if(postMatch) {
		post = postMatch[1];
		if(singlePosts[post]) {
			return out(res, 200, singlePosts[post]);
		}
	}

	var page=0;
	var pageMatch=req.url.match( /^\/(\d+)/ );
	if(pageMatch) {
		page = parseInt(pageMatch[1]);
	}
	if(blogStream[page]) {
		return out(res, 200, blogStream[page]);
	} else {
		return out(res, 404, '404');
	}

}

rebuild();

http.createServer(serve).listen(1337, '127.0.0.1');

mlog('Running');
