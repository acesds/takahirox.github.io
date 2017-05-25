( function () {

	var TRANSFER_TYPE_SNOOP = 0;
	var TRANSFER_TYPE_SYNC = 1;
	var TRANSFER_TYPE_ADD = 2;
	var TRANSFER_TYPE_REMOVE = 3;

	var TRANSFER_COMPONENT = {
		id: '',
		type: -1,
		list: []
	};

	// TODO: support interpolation
	// TODO: support packet loss recover for UDP

	THREE.RemoteSync = function ( client ) {

		var self = this;

		this.client = client;

		this.id = client.id;

		this.localObjects = [];
		this.localObjectTable = {};
		this.localObjectInfos = {};

		this.transferComponentsSync = {};

		this.remoteObjectTable = {};

		this.onOpens = [];
		this.onCloses = [];
		this.onErrors = [];
		this.onConnects = [];
		this.onDisconnects = [];
		this.onReceives = [];
		this.onAdds = [];
		this.onRemoves = [];

		this.client.addEventListener( 'open', function( id ) { self.onOpen( id ); } );
		this.client.addEventListener( 'close', function( id ) { self.onClose( id ); } );
		this.client.addEventListener( 'error', function( error ) { self.onError( error ); } );
		this.client.addEventListener( 'connect', function( id ) { self.onConnect( id ); } );
		this.client.addEventListener( 'disconnect', function( id ) { self.onDisconnect( id ); } );
		this.client.addEventListener( 'receive', function( data ) { self.onReceive( data ); } );

	};

	Object.assign( THREE.RemoteSync.prototype, {

		// public

		addEventListener: function ( type, func ) {

			switch ( type ) {

				case 'open':
					this.onOpens.push( func );
					break;

				case 'close':
					this.onCloses.push( func );
					break;

				case 'error':
					this.onErrors.push( func )
					break;

				case 'connect':
					this.onConnects.push( func )
					break;

				case 'disconnect':
					this.onDisconnects.push( func );
					break;

				case 'receive':
					this.onReceives.push( func );
					break;

				case 'add':
					this.onAdds.push( func );
					break;

				case 'remove':
					this.onRemoves.push( func );
					break;

				default:
					console.log( 'THREE.RemoteSync.addEventListener: Unknown type ' + type );
					break;

			}

		},

		connect: function ( destId ) {

			this.client.connect( destId );

		},

		addLocalObject: function ( object, info ) {

			if ( this.localObjectTable[ object.uuid ] !== undefined ) return;

			if ( info === undefined ) info = {};

			this.localObjectTable[ object.uuid ] = object;
			this.localObjects.push( object );

			this.localObjectInfos[ object.uuid ] = info;

			this.transferComponentsSync[ object.uuid ] = {
				id: object.uuid,
				matrix: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ]
			};

			this.broadcastObjectAddition( object );

		},

		removeLocalObject: function ( object ) {

			delete this.localObjectTable[ object.uuid ];
			delete this.transferComponentsSync[ object.uuid ];

			var readIndex = 0;
			var writeIndex = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				if ( this.localObjects[ i ] === object ) {

					this.localObjects[ writeIndex ] = this.localObjects[ readIndex ];
					writeIndex ++;

				}

				readIndex ++;

			}

			this.localObjects.length = writeIndex;

			this.broadcastObjectRemoval( object );

		},

		addRemoteObject: function ( destId, objectId, object ) {

			if ( this.remoteObjectTable[ destId ] === undefined ) this.remoteObjectTable[ destId ] = {};

			var objects = this.remoteObjectTable[ destId ];

			if ( objects[ objectId ] !== undefined ) return;

			objects[ objectId ] = object;

		},

		sync: function ( force ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.type = TRANSFER_TYPE_SYNC;

			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				var object = this.localObjects[ i ];

				if ( force === true || this.checkUpdate( object ) ) {

					list.push( this.serialize( object ) );

				}

			}

			this.client.broadcast( component );

		},

		// private

		removeRemoteObject: function ( destId, objectId ) {

			if ( this.remoteObjectTable[ destId ] === undefined ) return;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects[ objectId ] === undefined ) return;

			var object = objects[ objectId ];

			delete objects[ objectId ];

			for ( var i = 0, il = this.onRemoves.length; i < il; i ++ ) {

				this.onRemoves[ i ]( destId, objectId, object );

			}

		},

		onOpen: function ( id ) {

			this.id = id;

			for ( var i = 0, il = this.onOpens.length; i < il; i ++ ) {

				this.onOpens[ i ]( id );

			}

		},

		onClose: function ( id ) {

			for ( var i = 0, il = this.onCloses.length; i < il; i ++ ) {

				this.onCloses[ i ]( id );

			}

		},

		onError: function ( error ) {

			for ( var i = 0, il = this.onErrors.length; i < il; i ++ ) {

				this.onErrors[ i ]( error );

			}

		},

		onConnect: function ( id ) {

			for ( var i = 0, il = this.onConnects.length; i < il; i ++ ) {

				this.onConnects[ i ]( id );

			}

			this.sendObjectsAddition( id );

			this.sendSnoopList( id );

			this.sync( true );

		},

		onDisconnect: function ( id ) {

			var objects = this.remoteObjectTable[ id ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = this.onDisconnects.length; i < il; i ++ ) {

				this.onDisconnects[ i ]( id );

			}

			var keys = Object.keys( objects );

			for ( var i = 0, il = keys.length; i < il; i ++ ) {

				this.removeRemoteObject( id, keys[ i ] );

			}

		},

		createObjectsAdditionComponent: function () {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.type = TRANSFER_TYPE_ADD;

			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.localObjects.length; i < il; i ++ ) {

				var object = this.localObjects[ i ];
				var info = this.localObjectInfos[ object.uuid ];

				list.push( { id: object.uuid, info: info } );

			}

			return component;

		},

		createObjectAdditionComponent: function ( object ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.type = TRANSFER_TYPE_ADD;

			var list = component.list;
			list.length = 0;

			var info = this.localObjectInfos[ object.uuid ];

			list.push( { id: object.uuid, info: info } );

			return component;

		},

		broadcastObjectAddition: function ( object ) {

			this.client.broadcast( this.createObjectAdditionComponent( object ) );

		},

		sendObjectsAddition: function ( destId ) {

			this.client.send( destId, this.createObjectsAdditionComponent() );

		},

		broadcastObjectsAddition: function () {

			this.client.broadcast( this.createObjectsAdditionComponent() );

		},

		createObjectRemovalComponent: function ( object ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.type = TRANSFER_TYPE_REMOVE;

			var list = component.list;
			list.length = 0;

			list.push( { id: object.uuid } );

			return component;

		},

		sendObjectRemoval: function ( destId, object ) {

			this.client.send( destId, this.createObjectRemovalComponent( object ) );

		},

		broadcastObjectRemoval: function ( object ) {

			this.client.broadcast( this.createObjectRemovalComponent( object ) );

		},

		checkUpdate: function ( object ) {

			var component = this.transferComponentsSync[ object.uuid ];

			var array = component.matrix;
			var array2 = object.matrix.elements;

			for ( var i = 0, il = array.length; i < il; i ++ ) {

				if ( array[ i ] !== array2[ i ] ) return true;

			}

			return false;

		},

		serialize: function ( object ) {

			var component = this.transferComponentsSync[ object.uuid ];

			var array = component.matrix;
			var array2 = object.matrix.elements;

			for ( var i = 0, il = array.length; i < il; i ++ ) {

				array[ i ] = array2[ i ];

			}

			return component;

		},

		deserialize: function ( object, component ) {

			object.matrix.fromArray( component.matrix );
			object.matrix.decompose( object.position, object.quaternion, object.scale );

		},

		onSync: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var object = objects[ list[ i ].id ];

				if ( object === undefined ) continue;

				this.deserialize( object, list[ i ] );

			}

		},

		// TODO: temporal. Is this safe?
		sendSnoopList: function ( id ) {

			var component = TRANSFER_COMPONENT;
			component.id = this.id;
			component.type = TRANSFER_TYPE_SNOOP;

			var list = component.list;
			list.length = 0;

			for ( var i = 0, il = this.client.connections.length; i < il; i ++ ) {

				list.push( this.client.connections[ i ].peer );

			}

			this.client.send( id, component );

		},

		snoop: function ( component ) {

			var ids = component.list;

			for ( var i = 0, il = ids.length; i < il; i ++ ) {

				var id = ids[ i ];

				if ( this.id === id || this.client.hasConnection( id ) ) continue;

				this.connect( id );

			}

		},

		onReceive: function ( component ) {

			switch ( component.type ) {

				case TRANSFER_TYPE_SNOOP:

					this.snoop( component );
					break;

				case TRANSFER_TYPE_SYNC:

					this.onSync( component );
					break;

				case TRANSFER_TYPE_ADD:

					this.onAdd( component );
					break;

				case TRANSFER_TYPE_REMOVE:

					this.onRemove( component );
					break;

				default:

					console.log( 'THREE.RemoteSync.unReceive: Unknown type ' + component.type );
					break;

			}

			for ( var i = 0, il = this.onReceives.length; i < il; i ++ ) {

				this.onReceives[ i ]( component );

			}

		},

		onAdd: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				if ( objects === undefined || objects[ list[ i ].id ] === undefined ) {

					for ( var j = 0, jl = this.onAdds.length; j < jl; j ++ ) {

						this.onAdds[ j ]( destId, list[ i ] );

					}

				}

			}

		},

		onRemove: function ( component ) {

			var destId = component.id;
			var list = component.list;

			var objects = this.remoteObjectTable[ destId ];

			if ( objects === undefined ) return;

			for ( var i = 0, il = list.length; i < il; i ++ ) {

				var objectId = list[ i ].id;

				this.removeRemoteObject( destId, list[ i ].id );

			}

		},

	} );

} )();
