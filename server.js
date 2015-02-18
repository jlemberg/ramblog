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
	postOpening: "<article>\n",
	postClosing: "</article>\n",
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
conf.postSeparator = conf.postClosing + conf.postOpening;

var rebuilding = false;
var blogStream = [];
var singlePosts = {};
var taggedPosts = {};

function mlog(what) {
	console.log(new Date().getTime() + "\t" + what);
}

function handleTags(postContent, headerHtml) {
	var regex = /#([^0-9][a-z0-9]+)/i;
	var matches;
	var tags={};
	while(matches = postContent.match(regex)) {
		postContent = postContent.replace(regex, "<a class=\"tag\" href=\"/$1\">$1</a>");
		tags[matches[1]] = true;
	}

	for(var tag in tags) {
		if(!taggedPosts[tag]) {
			taggedPosts[tag] = [headerHtml];
		}
		taggedPosts[tag].push(conf.postOpening + postContent + conf.postClosing);
	}

	return postContent;
}

function rebuild() {
	if(rebuilding) {
		mlog('Rebuild already triggered. Aborting');
		return;
	}
	mlog('Rebuilding...');
	rebuilding = true;

	var headerHtml = fs.readFileSync(constants.headerFile, constants.readOptions);
	var footerHtml = fs.readFileSync(constants.footerFile, constants.readOptions);
	var scannedPosts = fs.readdirSync(constants.postsDir);
	var unprocessedPosts = [];

	for(var i=0,j=scannedPosts.length;i<j;i++) {
		if(scannedPosts[i].match(/^\w+\.md$/)) {
			unprocessedPosts.push(scannedPosts[i]);
		}
	}	

	var postCount = unprocessedPosts.length;

	var pages = Math.ceil(postCount / conf.postsPerPage);
	var page = 0;

	unprocessedPosts.sort(function(a,b){
		return fs.statSync(path.join(constants.postsDir,b)).ctime.getTime() -
			fs.statSync(path.join(constants.postsDir,a)).ctime.getTime();
	});

	mlog('Reading '+postCount+' posts...');
	
	var posts = [];
	taggedPosts = {};

	for(var i=0; i<postCount; i++) {
		var postPath = path.join(constants.postsDir, unprocessedPosts[i]);
		var postContent = fs.readFileSync(postPath, constants.readOptions);
		var ctime = fs.statSync(postPath).ctime;
		postContent += "\n\n"+'<a href="/'+unprocessedPosts[i]+'">'+unprocessedPosts[i]+"</a> - "+ctime.toString();
		postContent = marked(postContent);
		postContent = handleTags(postContent, headerHtml);
		posts.push({title:unprocessedPosts[i], content:postContent});
	}

	var tags=[];
	for(var tag in taggedPosts) {
		tags.push(tag);
	}
	tags.sort(function(a,b){
		return taggedPosts[b].length - taggedPosts[a].length;
	});

	var tagDiv = '<section><h3>tags</h3><ol>';
	for(var i=0, j=tags.length;i<j; i++) {
		tagDiv += '<li><a href="/'+tags[i]+'">'+tags[i]+'</a> ('+(taggedPosts[tags[i]].length-1)+')</li>';
	}
	tagDiv += '</ol></section>';

	for(var tag in taggedPosts) {
		taggedPosts[tag].push( '<a href="/">&lt; home</a>' );
		taggedPosts[tag].splice(1,0,tagDiv);
		taggedPosts[tag].push(footerHtml);
		taggedPosts[tag] = taggedPosts[tag].join("\n");
	}


	var htmlBlocks = [];
	var postBlocks = [];

	for(var i=0; i<postCount; i++) {
		mlog(i+': placing ' +posts[i].title+ ' on page '+page+'/'+(pages-1));

		var singlePostHtmlBlocks = [];
		singlePostHtmlBlocks.push(headerHtml);
		singlePostHtmlBlocks.push(tagDiv);
		singlePostHtmlBlocks.push(conf.postOpening);
		singlePostHtmlBlocks.push(posts[i].content);
		singlePostHtmlBlocks.push(conf.postClosing);
		singlePostHtmlBlocks.push( '<a href="/">&lt; home</a>' );
		singlePostHtmlBlocks.push(footerHtml);
		singlePosts[posts[i].title] = singlePostHtmlBlocks.join("\n");

		postBlocks.push(posts[i].content);

		if((page == 0 && i == conf.postsPerPage) || !((i+1)%conf.postsPerPage) || i==(postCount-1)) {
			htmlBlocks.push( headerHtml );
			htmlBlocks.push( tagDiv );
			htmlBlocks.push(conf.postOpening);
			htmlBlocks.push(postBlocks.join(conf.postSeparator));
			htmlBlocks.push(conf.postClosing);

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
		var post = postMatch[1];
		if(singlePosts[post]) {
			return out(res, 200, singlePosts[post]);
		}
	}

	var tagMatch=req.url.match(/\/([^0-9][a-z0-9]+)/i);
	if(tagMatch) {
		var tag = tagMatch[1];
		if(taggedPosts[tag]) {
			return out(res, 200, taggedPosts[tag]);
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

fs.watch(constants.postsDir, function(evt, file){
	if(evt == 'rename') {
		if(file.match(/^\w+\.md$/)) {
			mlog('Something changed. Better rebuild');
			rebuild();
		}
	}
});

rebuild();

http.createServer(serve).listen(1337, '127.0.0.1');

mlog('Running');
