var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var child_handles = [];
var SCREENSHOT_OUTPUT_PATH = "/home/mkurian/catkin_ws/src/bwi_nodejs_client/public/rviz_bin";
var ros_pid, rviz_pid, alive = true;

Date.MIN_VALUE = new Date(-8640000000000000);

var exec = function() {
    var cp = child_process.exec.apply(child_process, arguments);
    child_handles.push(cp);
    return cp;
}

var spawn = function() {
    var cp = child_process.spawn.apply(child_process, arguments);
    child_handles.push(cp);
    return cp;
}

var kill = function() {
    if (alive) {
        alive = false;

        setTimeout(function(){
            exec("kill " + ros_pid, function(err, stdout, stderr) {
                exec("kill " + rviz_pid, function(err, stdout, stderr) {

                    child_handles.forEach(function(child_process) {
                        console.log("killed " + child_process.pid);
                        child_process.kill('SIGINT');
                    });

                    send("kill", "process terminated. flushed proceses");

                    return process.exit(0);
                });
            });
        }, 3000);
    }
}

var getLastModifiedFile = function(dir) {
    var filename;
    var date = Date.MIN_VALUE;
    fs.readdirSync(dir).forEach(function(file) {
        var mdate = fs.statSync(path.join(dir, file)).mtime;
        if (mdate > date) {
            filename = file;
            date = mdate
        }
    });
    return filename;
}

var send = function(type, data) {
    process.send({
        type: type,
        data: data
    });
}

var bash = spawn("bash");

bash.stdout.on('data', function(buf) {
    console.log(buf = String(buf))
    send("cout", buf);
});

bash.stderr.on('data', function(buf) {
    console.log(buf = String(buf));
    send("cerr", buf);
});

bash.stdin.write("roslaunch bwi_nav2d nav2d_mapper_krr2014.launch --screen");
bash.stdin.end();

send("load", "waiting on roslaunch");

setTimeout(function() {
    exec("/usr/bin/pgrep roslaunch", function(err, stdout, stderr) {
        if (err) {
            return send("fail", "failed to find ros_pid");
        }

        ros_pid = stdout;

        process.on('message', function(data) {
            switch (data.type) {
                case "kill":
                    return kill();
            }
        })

        var lastscreen;

        setTimeout(function() {
            exec("pidof rviz", function(err, stdout, stderr) {
                rviz_pid = stdout;
                var capture = function(done) {
                    console.log("taking screenshot");
                    exec("kill -10 " + rviz_pid, function(err, stdout, stderr) {
                        setTimeout(function() {
                            try {
                                if (lastscreen) {
                                    fs.unlinkSync(lastscreen);
                                }
                                var file = getLastModifiedFile(SCREENSHOT_OUTPUT_PATH);
                                var currscreen = path.join(SCREENSHOT_OUTPUT_PATH, file);
                                lastscreen = currscreen;
                                send("update", file);
                            } catch (e) {
                                console.error(e);
                                lastscreen = null;
                                return done(1);
                            }
                            done(0);
                        }, 2000);
                    });
                };
                send("load", "initialized mapping. please wait...");
                exec("rosservice call /StartMapping 3", function(err, stdout, stderr) {
                    if (err) {
                        return console.error(err);
                    }
                    capture(function(){
                        send("load", "waiting for positioning.  please wait...");
                        setTimeout(function() {

                            console.log("starting exploration");
                            send("load", "initialized exploration.  please wait...");
                            exec("rosservice call /StartExploration 2", function() {
                                if (err) {
                                    return console.error(err);
                                }
                                var loop = function(){
                                    capture(function(err){
                                        if(err) {
                                            send("error", "retrying after 4 seconds");
                                            return setTimeout(loop, 8000);
                                        } else {
                                            send("info", "exploring environment");
                                        }

                                        setTimeout(loop, 4000);
                                    });
                                };

                                loop();
                            });
                        }, 10000);
                    });
                });
            });
        }, 10000);
    });
}, 2000);
