var getLong = new Function("x0, x1, x2, x3, x4, x5, x6, x7", "return ((x7 << 56) + (x6 << 48) + (x5 << 40) + (x4 << 32) + (x3 << 24) + (x2 << 16) + (x1 << 8) + x0)");
var getInt = new Function("x0, x1, x2, x3", "return ((x3 << 24) + (x2 << 16) + (x1 << 8) + x0)");
var log = function(data) {
    console.log(data);
};
var logArray = function(data, i) {
    for (var i = 0; i < data.length; i++) {
        log(data[i]);
    }
};
var getIntFrom = function(data, start) {
    return getInt(data[start++], data[start++], data[start++], data[start++]);
};
var getString = function(data, offset, len) {
    return data.toString('utf-8', offset, offset + len)
};
var getNext = function(dataBuffer) {
    var result = dataBuffer.buffer[dataBuffer.position]
    dataBuffer.position++;
    return result;
};
var getDataSize = function(buffer) {
    var result = 0;
    for (var i = 0; i < buffer.length; i++) {
        result += buffer[i];
    }
    return result;
};
var readAllBytes = function(dataBuffer, length) {
    var result = new Buffer(length);
    for (var i = 0; i < length; i++) {
        result[i] = dataBuffer.buffer[dataBuffer.position++];
    }
    return result;
};
var readPage = function(dataBuffer) {
    for (var i = 0; i < 4; i++) {
        getNext(dataBuffer); // skip "OggS"
    }
    var page = new Page();
    page.version = getNext(dataBuffer);
    page.flags = getNext(dataBuffer);
    page.granulePosition = getLong(getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer));
    page.sid = getInt(getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer));
    page.sequenceNum = getInt(getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer));
    page.checkSum = getInt(getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer), getNext(dataBuffer));
    page.segmentsNumber = getNext(dataBuffer);
    page.segments = readAllBytes(dataBuffer, page.segmentsNumber);
    page.dataSize = getDataSize(page.segments);
    page.data = readAllBytes(dataBuffer, page.dataSize);
    return page;
};

function Data(buffer, position) {
    this.buffer = buffer;
    this.position = position;
};

function PacketReader(dataBuffer) {
    this.dataBuffer = dataBuffer;
    this.page = readPage(this.dataBuffer);
    this.hasNextPacket = function () {
        return (this.page.hasNextPacket() || this.dataBuffer.buffer[this.dataBuffer.position+1] != undefined);
    }
    this.getNextPacket = function () {
        if (!this.page.hasNextPacket()) {
            this.page = readPage(this.dataBuffer);
        }
        var packet = this.page.getNextPacket();
        packet.parent = this.page;
        var data = packet.data;
        while (packet.continueOnNextPage) {
            this.page = readPage(this.dataBuffer);
            var newPacket = this.page.getNextPacket();
            var newData = new Buffer(data.length + newPacket.data.length);
            data.copy(newData, 0, 0, data.length);
            newPacket.data.copy(newData, data.length, 0, newPacket.data.length);
            data = newData;
            packet.continueOnNextPage = newPacket.continueOnNextPage;
        }
        packet.data = data;
        return packet;
    }
}
function Page() {
    this.currentOffset = 0;
    this.currentSegment = 0;
    this.hasNextPacket = function() {
        if (this.currentSegment < this.segmentsNumber) {
            return true;
        }

        if (this.currentSegment == 0 && this.segmentsNumber == 0) {
            return true;
        }

        return false;
    };
    this.getNextPacket = function() {
        var packetSize = 0;
        var packetSegments = 0;
        var continueOnNextPage = false;
        for (var i = this.currentSegment; i < this.segmentsNumber; i++) {
            var size = this.segments[i];
            packetSize += size;
            packetSegments++;

            if (size < 255)
                break;

            if (i === this.segmentsNumber - 1 && size === 255)
                continueOnNextPage = true;
        }

        var packetData = new Buffer(packetSize);
        for (var i = this.currentSegment; i < this.currentSegment + packetSegments; i++) {
            var size = this.segments[i];
            var offset = (i - this.currentSegment) * 255;
            this.data.copy(packetData, offset, this.currentOffset + offset, this.currentOffset + offset + size);
        }

        var packet = new Object();
        packet.data = packetData;
        packet.continueOnNextPage = continueOnNextPage;
        this.currentSegment += packetSegments;
        this.currentOffset += packetSize;
        return packet;
    }
}
var VorbisFile = function() {
    this.lastGranulePosition = -1;
    this.audioPackets = [];
    this.i = 0;
    this.handleAudioPacket = function(audioData) {
        this.audioSize += audioData.data.length;
        if (audioData.parent.granulePosition > this.lastGranulePosition)
            this.lastGranulePosition = audioData.parent.granulePosition;
        this.audioPackets[this.i++] = audioData;
    };
    this.handleInfoPacket = function(infoData) {
        this.infoPacket = infoData;
    };
    this.handleCommentsPacket = function(commentsData) {
        this.commentsPacket = commentsData;
    };
    this.handleSetupPacket = function(setupData) {
        this.setupPacket = setupData;
    };
    this.getDuration = function() {
        return (this.lastGranulePosition/this.infoPacket.rate);
    };
    this.getComments = function() {
        return (this.commentsPacket.comments);
    };
    this.getBitrate = function() {
        return (this.infoPacket.bitrate);
    };
};
var Parser = function (file) {
    var fs = require('fs');
    var buffer = fs.readFileSync(file);
    this.dataBuffer = new Data(buffer, 0);
    this.packetReader = new PacketReader(this.dataBuffer);
    this.vorbisFile = new VorbisFile();
    this.parse = function() {
        //info
        var infoPacket = this.packetReader.getNextPacket();
        infoPacket.type = "Info";
        infoPacket.version = getIntFrom(infoPacket.data, 7);
        infoPacket.chanels = infoPacket.data[11];
        infoPacket.rate = getIntFrom(infoPacket.data, 12);
        infoPacket.bitrateUpper = getIntFrom(infoPacket.data, 16);
        infoPacket.bitrate = getIntFrom(infoPacket.data, 20);
        infoPacket.bitrateLower = getIntFrom(infoPacket.data, 24);
        infoPacket.blockSize = infoPacket.data[28];
        this.vorbisFile.handleInfoPacket(infoPacket);
        //Comments packet
        var commentsPacket = this.packetReader.getNextPacket();
        var dataBegins = 7;
        var len = getIntFrom(commentsPacket.data, dataBegins);
        commentsPacket.vendor = getString(commentsPacket.data, dataBegins + 4, len);
        commentsPacket.comments = [];
        var currentComment = 0;
        var currentPointer = dataBegins + 4 + len;
        var commentsNumber = getIntFrom(commentsPacket.data, currentPointer);
        currentPointer += 4;
        for (var i = 0; i < commentsNumber; i++) {
            len = getIntFrom(commentsPacket.data, currentPointer);
            currentPointer += 4;
            var comment = getString(commentsPacket.data, currentPointer, len);
            currentPointer += len;
            if (comment.indexOf('=') == -1) {
                continue;
            } else {
                commentsPacket.comments[currentComment++] = comment;
            }
        }
        this.vorbisFile.handleCommentsPacket(commentsPacket);
        //setup packet
        var setupPacket = this.packetReader.getNextPacket();
        setupPacket.numberOfCodeblocks = setupPacket.data[8];
        this.vorbisFile.handleSetupPacket(setupPacket);
        //audio
        while (this.packetReader.hasNextPacket()) {
            audioData = this.packetReader.getNextPacket();
            this.vorbisFile.handleAudioPacket(audioData);
        }
        return this.vorbisFile;
    };
};
/**
 * reading file
 **/
var file = process.argv[2]
var parser = new Parser(file);
var vorbisFile = parser.parse();
log(vorbisFile.getDuration());
logArray(vorbisFile.getComments());
log(vorbisFile.getBitrate());



