$(document).ready(function() {

    $.getJSON('/static/trivia.json',function main(data) {

        url = new URL(window.location.href);
        console.log('url: ' + url);
        username = url.searchParams.get("username");
        task = url.searchParams.get("task");
        assignment = url.searchParams.get("assignment");
        timerInterval = null;

        var intervalID;
        var wait_timeout = 10;
        if (task=='train') {
            var characters_avail = 70;    
        } else if (task=='test') {
            var characters_avail = 10;
        }

        var n_targets_train = 1;
        var timerPaused = false;

        function initDrag(clone) {

            let draggedFromSortableRight = false;
            let originalIndex = -1; // Variable to store the original index
            let cloneClone = clone;

            $( ".draggable" ).draggable({
                start: function(event, ui) {
                    // Check if the draggable was originally from #gallery-right
                    draggedFromSortableRight = $(this).parent().attr('id') === 'gallery-right';

                    // If it's from gallery-right, store the original index
                    if (draggedFromSortableRight) {
                        originalIndex = $(this).index();
                    } else {
                        // If it's from gallery-left, we don't need to clone it
                        originalIndex = -1;  // Reset index as it won't be used for gallery-left to gallery-left move
                    }
                },
                stop: function(event, ui) {
                    // Call the function to update the image IDs after drag ends
                    getIdsOfImages();
                },
                revert: function(droppableObj) {
                    return !droppableObj;
                }
            });

            $( ".droppable" ).droppable({
                accept: function(draggable) {
                    // Only accept the draggable if the droppable does not already contain a draggable element
                    return $(this).children('.draggable').length === 0;
                },
                drop: function( event, ui ) {
                    if ($(this).children('.draggable').length === 0) {
                        // Move the dragged element to the droppable area
                        $(ui.draggable).detach().css({top: 0, left: 0}).appendTo(this);

                        // Only clone the element if it was dragged from #gallery-right
                        if (draggedFromSortableRight&&cloneClone) {

                            // Clone the dragged element
                            var clone = $(ui.draggable).clone().addClass('cloned');

                            // Find all children of #gallery-right
                            var sortableRightChildren = $( "#gallery-right" ).children();

                            // Insert the clone back at the original index in gallery-right
                            if (originalIndex < sortableRightChildren.length) {
                                clone.insertBefore(sortableRightChildren.eq(originalIndex));
                            } else {
                                // If it's the last element, append it
                                $( "#gallery-right" ).append(clone);
                            }

                            // Reapply draggable functionality to the cloned element
                            clone.draggable({
                                start: function(event, ui) {
                                    // Track the origin of the cloned draggable
                                    draggedFromSortableRight = $(this).parent().attr('id') === 'gallery-right';
                                    // Store the original index again when this clone is dragged
                                    if (draggedFromSortableRight) {
                                        originalIndex = $(this).index();
                                    } else {
                                        originalIndex = -1;
                                    }
                                },
                                stop: function(event, ui) {
                                    // Call the function after drag ends
                                    getIdsOfImages();
                                },
                                revert: function(droppableObj) {
                                    return !droppableObj;
                                }
                            });

                            // Mark the original draggable as having been moved to gallery-left
                            $(ui.draggable).attr('data-moved', 'true');
                        }

                        // Update image IDs after successful drop
                        getIdsOfImages();
                    }
                }
            });
        }

        function resetDraggable() {
            $('.cloned').remove();

            $('.draggable').each(function() {
                $(this).detach().css({
                    'top': 0,
                    'left': 0
                }).appendTo('#gallery-right');
            });
        }

        function addMessages(messages) {
            for (const [key, value] of Object.entries(messages)) {
                $('#message-gallery .textbox:eq('+key+')').val(value)
            }
        }

        function getMessages() {
            var messageData = {};

            // Loop through all .textbox elements inside #message-gallery
            $('#message-gallery .textbox').each(function(index) {
                // Add the value of each textbox to the messageData object, with index as the key
                messageData[index] = $(this).val();
            });

            return JSON.stringify(messageData);  // Return the JSON string of the object
        }

        function arrangePics(side, ordering) {
            // Get the container element by its ID
            let container = $("#" + side);
            
            // Loop through the images inside the container
            container.children('div').each(function(index) {
                if (index in ordering) {
                    let image_src = "/static/image_" + ordering[index] + ".png";
                    // Find the img tag inside the current child div and update its src
                    $(this).children('img').attr("src", image_src);
                } else {
                    // Remove the div if no corresponding image is found
                    $(this).remove();
                }
            });
        }

        function getIdsOfImages() {
            var values = [];

            // Loop through each droppable div inside the gallery-left
            $('#gallery-left > div').each(function() {
                // Find all img elements inside draggable divs within the droppable
                let imgElements = $(this).find('div.draggable img');

                // Loop through each img element
                imgElements.each(function() {
                    let imgSrc = $(this).attr("src");

                    // Check if the imgSrc is valid (not null or empty)
                    if (imgSrc && imgSrc.match(/image_(\d+)\.png/)) {
                        // Extract the image ID using regex and push it to the values array
                        let imgId = imgSrc.match(/image_(\d+)\.png/)[1];
                        values.push(imgId);
                    }
                });
            });

            // Create JSON object from the values array, allow duplicates
            var jsonObj = {};
            for (var i = 0; i < values.length; i++) {
                jsonObj[i] = values[i];
            }

            // Output the JSON object
            $('#outputValues').val(JSON.stringify(jsonObj));
        }

        function setHeaders(s,name) {
            for (var i = 0; i < 3; i++) {
                $('#'+s+' .header:eq('+i+')').text(name + ' ' +String(i+1))
            }
        }

        function feedback(feedbacks) {
            for (const [key, value] of Object.entries(feedbacks)) {
                if (value) {
                    $('#feedback-gallery .tiny:eq('+key+')').text("\u2705");
                } else {
                    $('#feedback-gallery .tiny:eq('+key+')').text("\u26D4");
                }
            }
        }

        function updateCharacterCount() {
            const textAreas = document.querySelectorAll('.textbox');
            let totalChars = 0;

            // Loop through all text areas and count the characters
            textAreas.forEach((textarea) => {
                totalChars += textarea.value.length;
            });

            // Update the character count display
            document.getElementById('charCount').textContent = characters_avail - totalChars;
        }

        function randomMove() {
            // socket.emit('strike', {'username': username});
            if (turn==0) {
                $('#message-gallery .textbox:eq(0)').val(function(index, currentValue) {
                    return currentValue + '...'; // Add an ellipsis to the existing value
                });
            } else if (turn==1) {
                if ($('#outputValues').val()=='{}') {
                    $('#outputValues').val('{"0":"1","1":"2","2":"3"}')
                }
            }
        }

        function updateTimerDisplay(timer,red) {
            minutes = parseInt(timer / 60, 10);
            seconds = parseInt(timer % 60, 10);
            seconds = seconds < 10 ? "0" + seconds : seconds;
            
            var timerDisplay = $('#time-count');
            timerDisplay.html(minutes + ":" + seconds);


            $('#timer').removeClass('red');
            if (red && (timer < 5)) {
                $('#timer').addClass('red');
            }
        }

        function setMoveTimer(timer) {
            clearInterval(timerInterval);
            timerInterval = setInterval(function () {
                timer--;
                if (timer > 0) {
                    updateTimerDisplay(timer,true);
                } else {
                    randomMove();
                    socket.emit('random', {'username': username});
                    submitMove('send_button',false);
                    clearInterval(timerInterval);
                    // socket.emit('partner_timeout', {'username': username, 'partner': partner});
                }
            }, 1000);
        }

        function setWaitTimer() {
            clearInterval(timerInterval);
            var timer = wait_timeout;
            timerPaused = false;
            timerInterval = setInterval(function() {
                if (!timerPaused) {
                    timer--;
                    updateTimerDisplay(timer,true);
                    if (timer === 0) {
                        timerPaused = true;
                        if (typeof partner == 'undefined') {
                            $('#sub-banner').text('Time is up! You have been removed from the match pool. Click a gear to rejoin.');
                            socket.emit('status', {'username': username, 'status': 'paused'});
                        } else {
                            $('#sub-banner').text('Time is up! You have '+String(strikes+1)+' strike(s). Click a gear to rejoin.');
                            socket.emit('strike', {'username': username});
                        }
                        
                    }
                }
            }, 1000);
        }

        function setFeedbackTimer(timer) {
            clearInterval(timerInterval);
            timerInterval = setInterval(function () {
                timer--;
                if (timer > 0) {
                    updateTimerDisplay(timer,false);
                }
            }, 1000);
        }

        function submitMove(id,intentional) {

            if (turn==2) {
                if (id=="send_button") {
                    $('#message-gallery .textbox:eq(0)').val('accept')
                } else if (id=="send_button2") {
                    $('#message-gallery .textbox:eq(0)').val('challenge')
                }
            }

            var jsonData;
            var valid = true;

            if (role=='sender') {

                jsonData = getMessages();

                foo = $.parseJSON(jsonData)

                if (!Object.values(foo).join('')) {
                    valid = false;
                    $("#sub-banner").text("Write a message for your partner.");
                }

            } else if (role=='receiver') {

                jsonData = $('#outputValues').val();

                nTiles = Object.keys($.parseJSON(jsonData)).length

                if (task=='train' && nTiles<n_targets_train) {
                    valid = false;
                    $("#sub-banner").text("Select "+n_targets_train.toString()+" shape to complete the puzzle.");
                } else if (task=='test' && nTiles<2) {
                    valid = false;
                    $("#sub-banner").text("Select 2 shapes to complete the puzzle.");
                }

            }

            if (valid) {

                socket.emit('move', {'text': jsonData, 'username': username, 'task': task, 'intentional': intentional});
                $("#send_button").prop("disabled", true);

            }

        }


        ////////////////////////////////////////////////////////////////////////////////////////
        // gears stuff

        var funFacts = data['facts'];

        var currentHighlighted = null;
        var timerInterval = null;
        var gearBlack = new Image();
        var gearBlue = new Image();
        var imagesLoaded = 0; // Keep track of the number of loaded images

        // Update image paths
        gearBlack.src = './static/gear_black.png';
        gearBlue.src = './static/gear_blue.png';

        // Function to select a random gear and highlight it
        function selectRandomGear() {
            if (currentHighlighted) {
                drawGear($(currentHighlighted).get(0), gearBlack);
            }
            var randomIndex = Math.floor(Math.random() * 9) + 1;
            currentHighlighted = '#gear-' + randomIndex;
            drawGear($(currentHighlighted).get(0), gearBlue);
        }

        // Function to draw a gear (image) on the canvas
        function drawGear(canvas, img) {
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }

        // Function to apply cross-browser rotation
        function rotateGear(element, degrees) {
            $(element).css({
                'transform': 'rotate(' + degrees + 'deg)',
                '-ms-transform': 'rotate(' + degrees + 'deg)',
                '-moz-transform': 'rotate(' + degrees + 'deg)',
                '-webkit-transform': 'rotate(' + degrees + 'deg)',
                '-o-transform': 'rotate(' + degrees + 'deg)'
            });
        }

        // Function to display a random fun fact with "Fun fact: " prefix
        function displayRandomFunFact() {
            var randomFactIndex = Math.floor(Math.random() * funFacts.length);
            $('#sub-banner').text('Fun fact: ' + funFacts[randomFactIndex]);
        }

        // // Update the timer display and change color if less than 5 seconds
        // function updateTimerDisplay() {
        //     var timerDisplay = $('#time-count');
        //     timerDisplay.text(timer);
        //     if (timer < 5) {
        //         $('#timer').addClass('red');
        //     } else {
        //         $('#timer').removeClass('red');
        //     }
        // }

        // Click event handler for gears
        $('.gear').click(function() {
            if ($(this).is(currentHighlighted)) {
                if (timerPaused && (typeof partner == 'undefined')) {
                    socket.emit('status', {'username': username, 'status': 'waiting'});
                }
                var currentRotation = $(this).data('rotation') || 0;
                currentRotation += 30;
                rotateGear(this, currentRotation);
                $(this).data('rotation', currentRotation);
                setWaitTimer();
                selectRandomGear();
                displayRandomFunFact();
            }
        });

        // Initialize all canvases with the black gear image
        function initializeGears() {
            $('.gear').each(function() {
                drawGear(this, gearBlack);
            });
        }

        // Image onload function for gearBlack
        gearBlack.onload = function() {
            console.log("gearBlack image loaded.");
            imagesLoaded++;
            checkAllImagesLoaded(); // Check if all images are loaded
        };

        // Image onload function for gearBlue
        gearBlue.onload = function() {
            console.log("gearBlue image loaded.");
            imagesLoaded++;
            checkAllImagesLoaded(); // Check if all images are loaded
        };

        // Function to check if both images have loaded
        function checkAllImagesLoaded() {
            if (imagesLoaded === 2) { // Both images are loaded
                console.log("All images are loaded. Initializing gears.");
                initializeGears();
                selectRandomGear();
                setWaitTimer();
            }
        }


        ////////////////////////////////////////////////////////////////////////////////////////
        // event handlers

        // Add event listeners to all text areas
        const textAreas = document.querySelectorAll('.textbox');
        textAreas.forEach((textarea) => {
            textarea.addEventListener('input', updateCharacterCount);
        });

        // $('.textbox').on('input', function() {
        //     socket.emit('typing', {'partner': partner});
        // });

        $(".submit").click(function() {
            submitMove($(this).attr('id'),true);
        });


        ////////////////////////////////////////////////////////////////////////////////////////
        // socket

        // var socket;
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
            // Local development
            socket = io('http://127.0.0.1:8000', { transports: ['websocket'], reconnect: true });
        } else {
            // Production environment
            socket = io.connect('wss://science.zachary-wojtowicz.com', { transports: ['websocket'], reconnect: true });
        }

        socket.on('connect', function() {
            socket.emit('connected', {'username': username, 'task': task, 'assignment':assignment});
        });

        socket.on('refresh', function() {
            console.log('being refreshed...');
            socket.emit('update', {'username': username, 'task': task});
        });

        socket.on('done', function(data) {
            console.log("finishing for " + username);
            const message = JSON.stringify({
                type: data['type']
            });
            window.parent.postMessage(message,"*");
            socket.emit('userDisconnect');
            socket.disconnect();
        });

        // var typingTimeout;

        // socket.on('notify_typing', function() {
        //     $('#sub-banner').text('Your partner is typing...');

        //     clearTimeout(typingTimeout);

        //     typingTimeout = setTimeout(function() {
        //         $('#sub-banner').text('');
        //     }, 2000);
        // });

        socket.on('update', (data) => {

            console.log('getting an update: ' + JSON.stringify(data));

            if (data.hasOwnProperty('pair'))  {

                role = data['role'];
                turn = data['turn'];
                // task = data['task'];
                clone = (data['task']=='test')
                partner = data['partner'];
                strikes = data['strikes'];
                score = data['score'];

                $("#n-remaining").text(data['n_remaining']);
                $("#wait").hide();
                $("#game").show();
                $('#feedback-gallery').css('visibility', 'hidden');
                $("#send_button").prop("disabled", true);
                $('.textbox').attr('readonly',true);
                $("#sub-banner").text("");
                $("#reset_button").css('visibility', 'hidden');
                $("#send_button2").css('visibility', 'hidden');
                $("#send_button").text('Submit!');
                $("#button-container").css('visibility', 'visible');
                $("#rounds").css('visibility','visible');
                updateCharacterCount();
                $('#char-info').css('visibility', 'hidden');
                $('#timer').css('visibility', 'visible');

                if (task=='train') {
                    $('#message-gallery .textbox:gt('+(n_targets_train-1).toString()+')').remove();
                    $('#message-gallery .header:gt('+(n_targets_train-1).toString()+')').remove();
                    $('#gallery-left .header:gt('+(n_targets_train-1).toString()+')').remove();
                    $('#gallery-left .droppable:gt('+(n_targets_train-1).toString()+')').remove();
                    $('#feedback-gallery .header:gt('+(n_targets_train-1).toString()+')').remove();
                    $('#feedback-gallery .feedback-content:gt('+(n_targets_train-1).toString()+')').remove();
                }

                clearInterval(timerInterval);


                if (role=='sender') {

                    setHeaders('gallery-left','Target');
                    setHeaders('feedback-gallery','Guess');
                    $('#role').text('Your Role: Describer');

                    $('#char-info').css('visibility', 'visible');

                    $('#message-gallery .textbox:eq(0)').attr('maxlength', String(characters_avail));

                    if (task=='test') {

                        $('#message-gallery .textbox:gt(0)').remove();
                        // show the middle feedback, i.e. the delivered tile
                        $('#feedback-gallery .header:gt(0)').remove();
                        $('#feedback-gallery .header:eq(0)').text('Delivered')
                        $('#feedback-gallery .feedback-content:gt(0)').remove();
                        // $('#feedback-gallery .feedback-content:eq(0)').remove();
                        // // // // // // // //
                        $('#message-gallery .header:gt(0)').remove();
                        $('.tiny').remove();
                        $('#gallery-left .textbox:gt(1)').remove();
                        $('#gallery-left .droppable:gt(0)').remove();
                        $('#gallery-left .header:eq(0)').text('Target');
                        $('#gallery-left .header:gt(0)').remove();
                        $('#feedback_header').text('Delivered');
                        

                    }

                    arrangePics("gallery-right",$.parseJSON(data['start_s']));
                    arrangePics("gallery-left",$.parseJSON(data['targets']));


                    if (turn==0) {
                        
                        $('.textbox').val('');
                        $('.textbox').attr('readonly',false);
                        $('#message-gallery .textbox').attr('placeholder', 'Enter your message here...');
                        $("#send_button").prop("disabled", false);
                        
                        if (task=='train') {
                            $("#banner").text("Your Turn: Describe the target shape.");
                            $('#banner').css('color', 'red');
                        } else {
                            $("#banner").text("Your Turn: Send a message to your partner.");
                            $('#banner').css('color', 'red');
                        }

                        setMoveTimer(45);

                    } else if (turn==1) {

                        $("#banner").text("While your partner moves, click the highlighted (blue) gear at least once every 10 seconds. If you earn too many timeout strikes, your submission may be rejected.");
                        $('#banner').css('color', 'black');

                        $("#wait").show();
                        $("#game").hide();
                        $("#button-container").css('visibility', 'hidden');

                        setWaitTimer();

                    } else if (turn==2) {
                        
                        if (task=='train') {

                            $("#banner").text("Feedback: Review your performance below.");
                            $('#banner').css('color', 'black');
                            $("#feedback-gallery").css('visibility', 'visible');
                            arrangePics("feedback-gallery",$.parseJSON(data['move_2']));
                            feedback(data['score']);
                            addMessages($.parseJSON(data['move_1']));
                            
                            if (score==1) {
                                setFeedbackTimer(2.5);    
                            } else {
                                setFeedbackTimer(6);
                            }

                        } else if (task=='test') {

                            var groundTruth = $.parseJSON(data['targets']);
                            var move_2 = $.parseJSON(data['move_2']);

                            if (groundTruth[0]==move_2[1]) {

                                submitMove('send_button',false);

                            } else {

                                $("#banner").text("Your Turn: Decide to accept or challenge.");
                                $('#banner').css('color', 'red');
                                $("#feedback-gallery").css('visibility', 'visible');
                                // hack! switch the picture indeces because we have deleted the other two feedback frames
                                myVar = {0:move_2[1]}
                                // // // // // // // //
                                arrangePics("feedback-gallery",myVar);
                                feedback(data['score']);
                                addMessages($.parseJSON(data['move_1']));
                                $("#send_button").prop("disabled", false);
                                $("#send_button").text('Accept');
                                $("#send_button2").css('visibility', 'visible');

                                setMoveTimer(25);    

                            }



                        }

                    }

                } else if (role=='receiver') {

                    $('#role').text('Your Role: Selector');

                    setHeaders('gallery-left','Slot');
                    setHeaders('feedback-gallery','Target');
                    arrangePics("gallery-right",$.parseJSON(data['start_r']));
                    getIdsOfImages();
                    
                    if (task=='train') {
                        initDrag(false);
                    } else {
                        $('#message-gallery .textbox:gt(0)').remove();
                        $('#message-gallery .header:gt(0)').remove();
                        $('#gallery-left .header:eq(0)').text('True Target');
                        $('#gallery-left .header:eq(1)').text('Shape to Deliver');
                        $('#gallery-left .textbox:eq(2)').remove();
                        $('#gallery-left .header:eq(2)').remove();
                        $('#gallery-left .droppable:eq(2)').remove();
                        initDrag(true);
                    }

                    if (turn==0) {

                        resetDraggable();
                        // need to re-arrange pictures & get IDs *after* resetting draggable
                        arrangePics("gallery-right",$.parseJSON(data['start_r']));
                        getIdsOfImages();
                        $("#banner").text("While your partner moves, click the highlighted (blue) gear at least once every 10 seconds. If you earn too many timeout strikes, your submission may be rejected.");
                        $('#banner').css('color', 'black');
                        $('.textbox').val('');
                        $(".draggable").draggable("disable");

                        $("#wait").show();
                        $("#game").hide();
                        $("#button-container").css('visibility', 'hidden');

                        setWaitTimer();                        

                    } else if (turn==1) {

                        if (task=='train') {
                            $("#banner").text("Your Turn: Drag a shape from the gallery to guess the target shape.");
                            $('#banner').css('color', 'red');
                        } else {
                            $("#banner").text("Your Turn: Select both shapes.");
                            $('#banner').css('color', 'red');
                        }

                        resetDraggable();
                        addMessages($.parseJSON(data['move_1']));
                        $(".draggable").draggable("enable");
                        $("#reset_button").css('visibility', 'visible');

                        $('#reset_button').click(function() {
                            resetDraggable();
                            getIdsOfImages();
                        });

                        $("#send_button").prop("disabled", false);
                        
                        setMoveTimer(25);

                    } else if (turn==2) {   

                        $(".draggable").draggable("disable");
                        addMessages($.parseJSON(data['move_1']));

                        if (task=='train') {

                            $("#banner").text("Feedback: Review your performance below.");
                            $('#banner').css('color', 'black');
                            $("#feedback-gallery").css('visibility', 'visible');
                            var groundTruth = $.parseJSON(data['targets']);
                            var pics = Object.fromEntries(
                                Object.entries(groundTruth).filter(([key, value]) => ['0','1','2'].includes(key))
                                );
                            arrangePics("feedback-gallery",pics);
                            feedback(data['score']);

                            if (score==1) {
                                setFeedbackTimer(2.5);    
                            } else {
                                setFeedbackTimer(6);
                            }
                            

                        } else {

                            $("#banner").text("While your partner moves, click the highlighted (blue) gear at least once every 10 seconds. If you earn too many timeout strikes, your submission may be rejected.");
                            $('#banner').css('color', 'black');

                            $("#wait").show();
                            $("#game").hide();
                            $("#button-container").css('visibility', 'hidden');

                            setWaitTimer();

                        }

                    }
                }

            } else {

                $('#banner').text("Click on the highlighted (blue) gear to refresh the timer and remain eligible for matching. If the match timer goes to zero, you will be removed from the match queue and unable to proceed with the survey.");
                $("#wait").show();
                $("#game").hide();
                $("#button-container").css('visibility', 'hidden');
                $("#rounds").css('visibility','hidden');

            }

        });

    });

});

