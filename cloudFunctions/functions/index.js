const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const e = require('express');
const app = express();

var adminApp = admin.initializeApp (
    functions.config().admin
);

//Allow Cross origin requests
app.use(cors({origin: true}));

// ------ Database Automation

//Copy static user data to db on sign up
exports.copyUserData = functions.auth.user().onCreate((user) => {
    let ref = adminApp.database().ref(`users/${user.uid}`);
    ref.child('uid').set(user.uid);
    ref.child('email').set(user.email);
    ref.child('signUpDate').set(user.metadata.creationTime);
})

//when a user posts, record post pushId in userPosts for later bulk lookup
exports.updateUserPostsList = functions.database.ref('posts/{pushId}').onCreate((snap, context) => {
    let userPostsRef = admin.database().ref('userPosts').child(snap.child('uid').val()).child('active'); //userPosts/{uid}/active

    return userPostsRef.child(context.params.pushId).set(true);
})

//loops through userPosts list to update displayName on posts
exports.updateDisplayName = functions.database.ref('users/{uid}/displayName').onUpdate((snap, context) => {
    let uid = context.params.uid;
    return admin.database().ref(`users/${uid}`).child('displayName').once('value').then((nameSnap) => {
        let newName = nameSnap.val();
        return updatePostsDisplayName(uid,newName);
    })
})


// ------ ADMIN API ------

exports.adminApi = functions.https.onRequest(app);

app.post('/disableUser/:uid', (req, resp) => { //Test
    let key = req.get('auth');
    let uid = req.params.uid;

    return admin.database().ref('adminKeys').once('value').then((keySnap) => {
        if(keySnap.hasChild(key)) {
            return admin.auth().updateUser(uid, {
                disabled: true
            }).then(() => {
                hideUsersPosts(uid);
                admin.database().ref('users').child(uid).child('disabled').set('true')
                return resp.status(200).end();
            })
        } else {
            return resp.status(401).end();
        }
    })
})

app.delete('/hidePost/:id', (req, resp) => { //Test
    let key = req.get('auth');
    let uid = req.get('uid');
    let postId = req.params.id;
    let postIndex;

    return admin.database().ref('adminKeys').once('value').then((keySnap) => {
        if(keySnap.hasChild(key) && uid) {
            hidePost(uid, req.params.id);
            return resp.status(200).end();
        } else {
            return resp.status(401).end();
        }
    })
})

app.delete('/hideComment/:postId/:commentId', (req, res) => {
    let key = req.get('auth')
    let postId = req.params.postId
    let commentId = req.params.commentId
    return admin.database().ref('adminKeys').once('value', keySnap => {
        if(!keySnap.hasChild(key)){
            res.status(401).end()
        } else if(!(postId && commentId)){
            res.status(400).end()
        } else {
            admin.database().ref('comments').child(postId).child(commentId).child('removed').set('true')
            res.status(200).end()
        }
    })
})

app.get('/getComments/:postId', (req, res) =>  {
    let key = req.get('auth')
    let postId = req.params.postId
    return admin.database().ref('adminKeys').once('value', keySnap => {
        if(!keySnap.hasChild(key)) {
            res.status(401).end()
        } else if(!postId) {
            res.status(400).end()
        } else {
            admin.database().ref('comments').child(postId).once('value', snap => {
                let array =[]
                snap.forEach(childSnap => {
                    let comment = {
                        id: childSnap.key,
                        comment: childSnap
                    }
                    array.push(comment)
                })
                array.reverse()
                res.status(200).send(array)
            })
        }
    })
})

app.get('/getPosts/:index', (req, resp) => { //takes 'start' for first x posts, or index as post id to start at, if index != start, returns x+1 posts including reference index
    let key = req.get('auth');
    return admin.database().ref('adminKeys').once('value', (keySnap) => {
        if(keySnap.hasChild(key)) {
            if(req.params.index !== 'start') {
                admin.database().ref('posts').orderByChild('null').endAt(null, req.params.index).limitToLast(4).once('value', (snap) => {
                    let array = [];
                    snap.forEach(childSnap => {
                        let post = {
                            post: childSnap,
                            id: childSnap.key
                        }
                        array.push(post);
                    })
                    array.reverse();
                    resp.status(200).send(array);
                })
            } else {
                admin.database().ref('posts').limitToLast(3).once('value', (snap) => {
                    let array = [];
                    snap.forEach(childSnap => {
                        let post = {
                            post: childSnap,
                            id: childSnap.key
                        }
                        array.push(post);
                    })
                    array.reverse();
                    resp.status(200).send(array);
                })
            }
        } else {
            return resp.status(401).end();
        }
    })
})

app.get('/getUsers', (req, res) => {
    let key = req.get('auth');
    return admin.database().ref('adminKeys').once('value', keySnap => {
        if(keySnap.hasChild(key)) {
            admin.database().ref('users').once('value', snap => {
                let array = [];
                snap.forEach(childSnap => {
                    array.push(childSnap);
                })
                res.status(200).send(array);
            })
        } else {
            res.status(401).end();
        }
    })
})




// exports.removePost = functions.https.onCall((data, context) => {
//     let key = data.key;
//     let postId = data.postId;

//     //TODO CHECK KEY VALIDITY
//     //TODO hide post
// })

// exports.removeComment = functions.https.onCall((data, snapshot) => {
//     let key = data.key;
//     let postId = data.postId;
//     let commentId = commentId;

//     //TODO CHECK KEY VALIDITY
//     //todo delete comment
// })






// ------ SUPPORTING FUNCTIONS ------

//updateDisplayName supporting function
function updatePostsDisplayName(uid, newName) {
    let postsRef = admin.database().ref('posts');
    let userPostsRef = admin.database().ref(`userPosts/${uid}/active`);
    return userPostsRef.once('value').then((activeSnap) => {
        activeSnap.forEach((snap) => {
            postsRef.child(snap.key).child('displayName').set(newName);
        })
        return updateHiddenPostsDisplayName(uid, newName);
    })
}

//updateDisplayname supporting function
function updateHiddenPostsDisplayName(uid, newName) {
    let userPostsRefHidden = admin.database().ref(`userPosts/${uid}/hidden`);
    let hiddenPostsRef = admin.database().ref('hiddenPosts');
    return userPostsRefHidden.once('value').then((hiddenSnap) => {
        return hiddenSnap.forEach((snap) => {
            hiddenPostsRef.child(snap.key).child('displayName').set(newName);
        })
    })
}

//admin api supporting function
function hideUsersPosts(uid) { //Needs Testing
    let userPostsRefActive = admin.database().ref(`userPosts/${uid}/active`);
    let userPostsRefHidden = admin.database().ref(`userPosts/${uid}/hidden`);
    return userPostsRefActive.once('value').then((activeSnap) => {
        return activeSnap.forEach((snap) => {
            hidePost(uid, snap.key);
        })
    })
}


//admin api supporting function supporting function
function hidePost(uid, id) {
    let postRef = admin.database().ref('posts');
    let hiddenRef = admin.database().ref('hiddenPosts');
    let userPostsRefActive = admin.database().ref(`userPosts/${uid}/active`);
    let userPostsRefHidden = admin.database().ref(`userPosts/${uid}/hidden`);
    userPostsRefActive.child(id).remove();
    userPostsRefHidden.child(id).set(true);
    return postRef.child(id).once('value', (snapshot) => {
        hiddenRef.child(id).set(snapshot.val());
    }).then(() => {
        postRef.child(id).remove();
        return;
    })
}