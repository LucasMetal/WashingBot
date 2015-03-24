function washingMonitorSensorCallback(x, y, z, time){
    washingMonitor.executeSensorCallback(x, y, z, time);
}

(function (washingMonitor){

    washingMonitor.sensorCallbackFn = null;
    var monitor = null;

    var lastPulseX = lastPulseY = lastPulseZ = 0;
    
    /*
    var sensitivityX = 0.005;   // sensitivity of X axis in percent change
    var sensitivityY = 0.005;   // sensitivity of Y axis in percent change
    var sensitivityZ = 0.005;   // sensitivity of Z axis in percent change
    */
    
    var sensitivityX = 0.005;   // sensitivity of X axis in percent change
    var sensitivityY = 0.005;   // sensitivity of Y axis in percent change
    var sensitivityZ = 0.005;   // sensitivity of Z axis in percent change
    
    washingMonitor.executeSensorCallback = function (x, y, z, time){
        
        // Declare variables to read the pulse widths, change, and percentage change:
        var changeX, 
            changeY, 
            changeZ,
            percentX, 
            percentY,
            percentZ;    
        
        // Find the change in the pulse:
        changeX = lastPulseX - x;
        changeY = lastPulseY - y;
        changeZ = lastPulseZ - z;
        
        // Calculate the percentage change using absolute values:
        percentX = Math.abs(changeX / lastPulseX);
        percentY = Math.abs(changeY / lastPulseY);
        percentZ = Math.abs(changeZ / lastPulseZ);      
        
        console.log("Values: " + x + ", " + y + ", " + z);
        console.log("Percent: " + percentX +", "+ percentY + ", " + percentZ);
        
        // If the percentage change is less than the sensitivity (i.e. no movement detected)
        if (percentX > sensitivityX || percentY > sensitivityY || percentZ > sensitivityZ)
        { 
            washingMonitor.sensorCallbackFn(x, y, z, time);
        }
        
        // Set the last pulse equal to the current pulse
        lastPulseX = x;
        lastPulseY = y;
        lastPulseZ = z;
    }

    //TODO: Values should in caps, right?
    washingMonitor.eventTypes = {
        init: 0,
        start: 1,
        stop: 2,
        waitingWashingStart: 3,
        washingStarted: 4,
        washingNotStarted: 5,
        washingMovement: 6,
        finished: 7,
        finishedReminder: 8,
        personMovement: 9
    };

    // Matrix that indicates which callback to call for each eventType
    var notificationMatrix = {};
    notificationMatrix[washingMonitor.eventTypes.init] = "onInit";
    notificationMatrix[washingMonitor.eventTypes.start] = "onStart";
    notificationMatrix[washingMonitor.eventTypes.stop] = "onStop";
    notificationMatrix[washingMonitor.eventTypes.waitingWashingStart] = "onWaitingWashingStart";
    notificationMatrix[washingMonitor.eventTypes.washingStarted] = "onWashingStarted";
    notificationMatrix[washingMonitor.eventTypes.washingNotStarted] = "onWashingNotStarted";
    notificationMatrix[washingMonitor.eventTypes.washingMovement] = "onWashingMovement";
    notificationMatrix[washingMonitor.eventTypes.finished] = "onFinished";
    notificationMatrix[washingMonitor.eventTypes.finishedReminder] = "onFinishedReminder";
    notificationMatrix[washingMonitor.eventTypes.personMovement] = "onPersonMovement";

    washingMonitor.init = function(options){

        if (monitor){
            console.log("WashingMonitor already created, returning existing instance.");
            return monitor;
        }

        /* Options
        useSecondsForTime
        */

        var myMonitor = monitor = {};

        var timeOutHandler = null,
            startTimeoutHandler = null,
            sensor = null,
            startTime = null,
            finishTime = null,
            hasFinished = false,
            washingNotStartedCounter = 0,
            finishedReminderCounter = 0;

        myMonitor.start = function(){
            if (!sensor){
                sensor = app.CreateSensor("Accelerometer");
                sensor.SetOnChange(washingMonitorSensorCallback);
            }

            hasFinished = false;
            washingNotStartedCounter = 0;
            finishedReminderCounter = 0;

            // We start waiting for the machine moving in a few minutes, otherwise
            // we'll still have the cellphone in our hands.
            startTimeoutHandler = setTimeout(waitForStart, convertToMs(options.cellDropTimeoutMinutes));

            // This makes the monitor work when the display goes off
            // maybe this shouldn't be part of the monitor code itself,
            // but otherwise it won't work.
            app.PreventScreenLock("Partial");

            notifyEvent(washingMonitor.eventTypes.start);
        };

        myMonitor.stop = function(){
            if (startTimeoutHandler) clearTimeout(startTimeoutHandler);
            if (timeOutHandler) clearTimeout(timeOutHandler);
            sensor.Stop();

            notifyEvent(washingMonitor.eventTypes.stop);
        };

        myMonitor.hasFinished = function (){
            return hasFinished;
        };
        
        myMonitor.getStartTime = function (){
            return startTime;
        };

        myMonitor.getWashingDurationInMinutes = function (){
            return getWashingDurationInMinutes();
        };

        function waitForStart(){
            washingMonitor.sensorCallbackFn = configureSensorForWashingStarted;
            sensor.Start();

            timeOutHandler = setInterval(washingNotStarted, convertToMs(options.startTimeTimeoutMinutes));

            notifyEvent(washingMonitor.eventTypes.waitingWashingStart);
        }

        // Hack: This function is necessary because upon calling "Start", the sensor always fires an event
        function configureSensorForWashingStarted(){
            washingMonitor.sensorCallbackFn = washingStarted;
        }

        function washingStarted(){
            // We clear the washingStart interval
            clearInterval(timeOutHandler);

            startTime = new Date();

            // Now the machine is washing, on each movement we reset the counter
            washingMonitor.sensorCallbackFn = washingMovementDetected;
            washingMovementDetected();

            notifyEvent(washingMonitor.eventTypes.washingStarted);
        };

        function washingNotStarted(){
            notifyEvent(washingMonitor.eventTypes.washingNotStarted, washingNotStartedCounter++);
        }

        function washingMovementDetected( x, y, z, time){
            // Resets the laundryFinished timers, so it keeps counting
            if (timeOutHandler) clearTimeout(timeOutHandler);
            timeOutHandler = setTimeout(washingFinished, convertToMs(options.washingThresholdMinutes));

            // We save the last movement time, as the possible finish time, so we'll know exactly
            // when it stopped moving
            finishTime = new Date();

            notifyEvent(washingMonitor.eventTypes.washingMovement, getWashingDurationInMinutes(), x, y, z, time);
        }

        function washingFinished(){
            sensor.Stop();
            hasFinished = true;
            startReminder();

            notifyEvent(washingMonitor.eventTypes.finished, getWashingDurationInMinutes());
        }

        function startReminder() {
            timeOutHandler = setInterval(function () {
                var minsSinceFinish = convertToMinutes(new Date() - finishTime);

                notifyEvent(washingMonitor.eventTypes.finishedReminder, minsSinceFinish, finishedReminderCounter++);
            }, convertToMs(options.reminderIntervalMinutes));

            washingMonitor.sensorCallbackFn = personMovementDetected;
            sensor.Start();
        }

        function personMovementDetected(x, y, z, time) {
            sensor.Stop();
            clearInterval(timeOutHandler);

            notifyEvent(washingMonitor.eventTypes.personMovement, x, y, z, time);
        }

        function getWashingDurationInMinutes() {
            return convertToMinutes((hasFinished ? finishTime : new Date()) - startTime);
        }

        function convertToMs(minutes) {
            return minutes * 1000 * (options.useSecondsInsteadOfMinutes ? 1 : 60);
        }

        function convertToMinutes(ms) {
            return Math.floor(ms / 1000 / (options.useSecondsInsteadOfMinutes ? 1 : 60));
        }

        function notifyEvent(eventType){
            // Transform the arguments to an array, but skipping the first element
            var args = Array.prototype.slice.call(arguments,1);

            var eventHandler = options[notificationMatrix[eventType]];
            if (eventHandler) eventHandler.apply(myMonitor, args);

            // We always call the onEvent callback if it's defined.
            // Last param is the array of arguments.
            if (options.onEvent) options.onEvent(eventType, args);
        }

        notifyEvent(washingMonitor.eventTypes.init);

        return myMonitor;
    };

}(this.washingMonitor = this.washingMonitor || {}));
