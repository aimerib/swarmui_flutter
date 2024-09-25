import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:swarmui_flutter/logger.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as ws_status;
import 'package:swarmui_flutter/models/gen_param_types.dart'; // Import the model

enum SwarmUIAPIStatus {
  idle,
  error,
  needsSettings,
  loading,
}

class SwarmUIAPI extends ChangeNotifier {
  String? serverAddress;
  String? sessionId;
  WebSocketChannel? channel;
  StreamController<Map<String, dynamic>>? wsStreamController;

  // New state variables
  SwarmUIAPIStatus status = SwarmUIAPIStatus.idle;
  String? errorMessage;

  // Stream subscription for WebSocket
  StreamSubscription? _wsSubscription;

  // Stream controllers for different types of updates
  final StreamController<ImageUpdate> _imageUpdateController = StreamController.broadcast();
  final StreamController<BackendStatus> _backendStatusController = StreamController.broadcast();
  final StreamController<ErrorMessage> _errorController = StreamController.broadcast();
  final StreamController<StatusUpdate> _statusUpdateController = StreamController.broadcast();

  // Reconnection settings
  final int _maxReconnectAttempts = 5;
  int _reconnectAttempts = 0;
  final Duration _reconnectDelay = const Duration(seconds: 5);
  Timer? _reconnectTimer;

  List<GenParamType> genParamTypes = []; // Add a list to store GenParamType objects
  final Map<String, bool> _toggledParams = {};
  final Map<String, bool> _toggledGroups = {};
  final Map<String, dynamic> _paramValues = {};
  final Map<String, List<String>> _promptImages = {};
  final List<String> _revisionImages = [];
  List<Preset> currentPresets = [];
  Map<String, List<String>> models = {};
  Map<String, dynamic> wildcards = {};
  String? currentModel;

  SwarmUIAPI() {
    _initialize();
  }
  Future<void> initialize() async {
    await _initialize();
  }
  /// Initialize the API by loading preferences and acquiring session.
  Future<void> _initialize() async {
    // Load serverAddress and sessionId from SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    serverAddress = prefs.getString('serverAddress');
    sessionId = prefs.getString('sessionId');

    if (serverAddress == null) {
      status = SwarmUIAPIStatus.needsSettings;
      notifyListeners();
      return;
    }

    await acquireSession();
  }

    bool isParamToggled(String paramId) {
    return _toggledParams[paramId] ?? false;
  }

  bool isGroupToggled(String groupId) {
    return _toggledGroups[groupId] ?? false;
  }

  dynamic getParamValue(String paramId) {
    return _paramValues[paramId];
  }

  List<String> getPromptImages(String paramId) {
    return _promptImages[paramId] ?? [];
  }

  List<String> getRevisionImages() {
    return _revisionImages;
  }

  double? getInitImageCreativity() {
    return _paramValues['initimagecreativity'] as double?;
  }

  void setParamValue(String paramId, dynamic value) {
    _paramValues[paramId] = value;
    notifyListeners();
  }

  void toggleParam(String paramId) {
    _toggledParams[paramId] = !(_toggledParams[paramId] ?? false);
    notifyListeners();
  }

  void toggleGroup(String groupId) {
    _toggledGroups[groupId] = !(_toggledGroups[groupId] ?? false);
    notifyListeners();
  }

  void addPromptImage(String paramId, String imageData) {
    _promptImages.putIfAbsent(paramId, () => []).add(imageData);
    notifyListeners();
  }

  void addRevisionImage(String imageData) {
    _revisionImages.add(imageData);
    notifyListeners();
  }

  void clearPromptImages(String paramId) {
    _promptImages[paramId]?.clear();
    notifyListeners();
  }

  void clearRevisionImages() {
    _revisionImages.clear();
    notifyListeners();
  }

  void addPreset(Preset preset) {
    currentPresets.add(preset);
    notifyListeners();
  }

  void removePreset(String title) {
    currentPresets.removeWhere((preset) => preset.title == title);
    notifyListeners();
  }


  /// Set the server address and reconnect WebSocket
  Future<void> setServerAddress(String address) async {
    serverAddress = address;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverAddress', address);
    status = SwarmUIAPIStatus.idle;
    notifyListeners();

    // Reconnect WebSocket with new server address
    // if (sessionId != null) {
    //   await connectWebSocket();
    // }
  }

  /// Acquire a new session from the server
  Future<void> acquireSession() async {
    if (serverAddress == null) {
      status = SwarmUIAPIStatus.needsSettings;
      notifyListeners();
      return;
    }

    status = SwarmUIAPIStatus.loading;
    notifyListeners();

    try {
      final response = await http.post(
        Uri.parse('$serverAddress/API/GetNewSession'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        sessionId = data['session_id'];

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('sessionId', sessionId!);

        status = SwarmUIAPIStatus.idle;
        notifyListeners();

        // Connect WebSocket after acquiring session
        // await connectWebSocket();

        // Initialize parameters after acquiring session
        await _initializeParameters();
      } else {
        throw Exception('Failed to get new session');
      }
    } catch (e) {
      status = SwarmUIAPIStatus.error;
      errorMessage = 'Failed to acquire session: $e';
      notifyListeners();
    }
  }

  /// Initialize parameters after acquiring session
  Future<void> _initializeParameters() async {
    try {
      status = SwarmUIAPIStatus.loading;
      notifyListeners();

      final response = await http.post(
        Uri.parse('$serverAddress/API/ListT2IParams'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'session_id': sessionId}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        genParamTypes = (data['list'] as List)
            .map((item) => GenParamType.fromJson(item))
            .toList();

        // Reset models map
        models = {};

        if (data['models'] is List) {
          for (var model in data['models']) {
            if (model is Map<String, dynamic>) {
              String subtype = model['subtype'] ?? 'default';
              String name = model['name'];
              if (!models.containsKey(subtype)) {
                models[subtype] = [];
              }
              models[subtype]?.add(name);
            }
          }
        } else if (data['models'] is Map<String, dynamic>) {
          data['models'].forEach((key, value) {
            if (value is List) {
              models[key] = value.cast<String>();
            }
          });
        } else {
          debugPrint('Unexpected models structure: ${data['models'].runtimeType}');
        }

        wildcards = data['wildcards'] as Map<String, dynamic>? ?? {};
        status = SwarmUIAPIStatus.idle;
        notifyListeners();
      } else {
        throw Exception('Failed to initialize parameters');
      }
    } catch (e) {
      status = SwarmUIAPIStatus.error;
      errorMessage = 'Failed to initialize parameters: $e';
      notifyListeners();
    }
  }

  /// Make a request with retry logic
  Future<String?> _makeRequestWithRetry(Function requestFunction) async {
    try {
      return await requestFunction();
    } catch (e) {
      // Assume the failure is due to invalid sessionId
      await acquireSession();

      if (status == SwarmUIAPIStatus.idle && sessionId != null) {
        try {
          return await requestFunction();
        } catch (e) {
          // Second attempt failed
          status = SwarmUIAPIStatus.error;
          errorMessage = 'Request failed after retry: $e';
          notifyListeners();
          return null;
        }
      } else {
        // Could not acquire a new session
        return null;
      }
    }
  }

  /// Generate image using HTTP request
  Future<String?> generateImage(String prompt) async {
    if (serverAddress == null || sessionId == null) {
      if (serverAddress == null) {
        status = SwarmUIAPIStatus.needsSettings;
        notifyListeners();
        return null;
      } else {
        await acquireSession();
        if (sessionId == null) {
          return null;
        }
      }
    }

    return await _makeRequestWithRetry(() async {
      final response = await http.post(
        Uri.parse('$serverAddress/API/GenerateText2Image'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'session_id': sessionId,
          'prompt': prompt,
          'images': 1,
        }),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['images'][0];
      } else {
        throw Exception('Failed to generate image');
      }
    });
  }

  Future<List<GenParamType>> fetchGenParams() async {
    await _initializeParameters();
    return genParamTypes;
  }

  bool get isServerSet => serverAddress != null;
  Future<bool> isSessionValid() async {
    final prefs = await SharedPreferences.getInstance();
    final sessionId = prefs.getString('sessionId');
    if (sessionId == null) {
      return false;
    }
    final response = await http.post(
        Uri.parse('$serverAddress/API/GetCurrentStatus'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'session_id': sessionId,
        }),
    );
    return response.statusCode == 200;
  }

  /// Connect to WebSocket for real-time updates with reconnection logic
  Future<void> connectWebSocket() async {
    if (serverAddress == null || sessionId == null) {
      throw Exception('Server address or session ID not set');
    }

    final wsUrl = serverAddress!.replaceFirst('http', 'ws');
    channel = WebSocketChannel.connect(
      Uri.parse('$wsUrl/API/GenerateText2ImageWS'),
    );

    wsStreamController = StreamController<Map<String, dynamic>>.broadcast();

    _wsSubscription = channel!.stream.listen(
      (message) {
        print('WebSocket message: $message');
        final decodedMessage = jsonDecode(message);
        wsStreamController!.add(decodedMessage);
        _handleWebSocketMessage(decodedMessage);
      },
      onError: (error) {
        print('WebSocket error: $error');
        wsStreamController!.addError(error);
        _errorController.add(ErrorMessage(
          error: error.toString(),
          timestamp: DateTime.now(),
        ));
        _attemptReconnect();
      },
      onDone: () {
        print('WebSocket connection closed');
        wsStreamController!.close();
        _attemptReconnect();
      },
    );
  }

  /// Attempt to reconnect with exponential backoff
  void _attemptReconnect() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      print('Max reconnect attempts reached. Giving up.');
      status = SwarmUIAPIStatus.error;
      errorMessage = 'Unable to reconnect to the server after multiple attempts.';
      notifyListeners();
      return;
    }

    _reconnectAttempts += 1;
    print('Attempting to reconnect in ${_reconnectDelay.inSeconds} seconds... ($_reconnectAttempts/$_maxReconnectAttempts)');

    _reconnectTimer = Timer(_reconnectDelay, () async {
      try {
        await connectWebSocket();
        _reconnectAttempts = 0; // Reset on successful connection
        print('Reconnected to WebSocket.');
      } catch (e) {
        print('Reconnection attempt failed: $e');
        _attemptReconnect(); // Retry again
      }
    });
  }

  /// Disconnect from WebSocket
  void disconnectWebSocket() {
    _wsSubscription?.cancel();
    channel?.sink.close(ws_status.goingAway);
    wsStreamController?.close();
    channel = null;
    wsStreamController = null;
  }

  /// Stream for WebSocket messages
  Stream<Map<String, dynamic>> get webSocketStream => wsStreamController!.stream;

  /// Send a message over WebSocket
  Future<void> sendWebSocketMessage(Map<String, dynamic> message) async {
    if (channel == null) {
      throw Exception('WebSocket not connected');
    }
    channel!.sink.add(jsonEncode(message));
  }

  /// Handle incoming WebSocket messages
  void _handleWebSocketMessage(Map<String, dynamic> message) {
    try {
      if (message.containsKey('image')) {
        // Handle image updates
        _imageUpdateController.add(ImageUpdate(
          imageUrl: message['image'],
          metadata: message['metadata'],
          batchId: message['batch_id'],
          isPreview: false,
        ));
      } else if (message.containsKey('gen_progress')) {
        // Handle generation progress updates
        final progress = message['gen_progress'];
        _imageUpdateController.add(ImageUpdate(
          progress: progress['overall_percent']?.toDouble(),
          currentProgress: progress['current_percent']?.toDouble(),
          batchId: '${progress['batch_id']}_${progress['batch_index']}',
          isProgress: true,
        ));
      } else if (message.containsKey('error')) {
        // Handle error messages
        _errorController.add(ErrorMessage(
          error: message['error'],
          timestamp: DateTime.now(),
        ));
      } else if (message.containsKey('status')) {
        // Handle status updates
        _statusUpdateController.add(StatusUpdate(
          waitingGens: (message['status']['waiting_gens'] ?? 0).toDouble(),
          loadingModels: (message['status']['loading_models'] ?? 0).toDouble(),
          waitingBackends: (message['status']['waiting_backends'] ?? 0).toDouble(),
          liveGens: (message['status']['live_gens'] ?? 0).toDouble(),
        ));
      } else if (message.containsKey('backend_status')) {
        // Handle backend status updates
        _backendStatusController.add(BackendStatus(
          status: message['backend_status']['status'],
          className: message['backend_status']['class'],
          message: message['backend_status']['message'],
          anyLoading: message['backend_status']['any_loading'],
        ));
      } else if (message.containsKey('discard_indices')) {
        // Handle discard indices
        // Implement as needed based on your specific requirements
      } else if (message.containsKey('keep_alive')) {
        // Handle keep-alive messages if necessary
        // Typically used to maintain the WebSocket connection
      }

      // Handle other message types as needed
    } catch (e, stack) {
      print('Error handling WebSocket message: $e');
      print(stack);
      _errorController.add(ErrorMessage(
        error: 'Error handling message: $e',
        timestamp: DateTime.now(),
      ));
    }
  }

  /// Stream for image updates
  Stream<ImageUpdate> get imageUpdateStream => _imageUpdateController.stream;

  /// Stream for backend status updates
  Stream<BackendStatus> get backendStatusStream => _backendStatusController.stream;

  /// Stream for error messages
  Stream<ErrorMessage> get errorStream => _errorController.stream;

  /// Stream for status updates
  Stream<StatusUpdate> get statusUpdateStream => _statusUpdateController.stream;

  /// Mock function to update all models
  void updateAllModels(List<dynamic> models) {
    // Implement the logic to update all models
  }

  /// Mock function to sort parameter list
  List<dynamic> sortParameterList(List<dynamic> list) {
    // Implement the logic to sort the parameter list
    return list;
  }

  /// Mock function to pre-initialize parameters
  void preInit() {
    // Implement the logic to pre-initialize parameters
  }

  /// Mock function to apply parameter edits
  void applyParamEdits(List<dynamic> paramEdits) {
    // Implement the logic to apply parameter edits
  }

  /// Mock function to load user parameter config tab
  void loadUserParamConfigTab() {
    // Implement the logic to load user parameter config tab
  }

  /// Mock function to generate inputs
  void genInputs() {
    // Implement the logic to generate inputs
  }

  /// Mock function to generate tools list
  void genToolsList() {
    // Implement the logic to generate tools list
  }

  /// Mock function to revise status bar
  void reviseStatusBar() {
    // Implement the logic to revise status bar
  }

  /// Mock function to toggle advanced options
  void toggleAdvanced() {
    // Implement the logic to toggle advanced options
  }

  /// Mock function to set the current model
  void setCurrentModel(String? model) {
    currentModel = model;
    // notifyListeners();
    // Implement the logic to set the current model
  }

  /// Mock function to load user data
  void loadUserData() {
    // Implement the logic to load user data
  }

  /// Mock function to display automatic welcome message
  void automaticWelcomeMessage() {
    // Implement the logic to display automatic welcome message
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel(); // Cancel any pending reconnection attempts
    disconnectWebSocket();
    _imageUpdateController.close();
    _backendStatusController.close();
    _errorController.close();
    _statusUpdateController.close();
    super.dispose();
  }
}

/// Model for image updates
class ImageUpdate {
  final String? imageUrl;
  final String? metadata;
  final String? batchId;
  final double? progress;
  final double? currentProgress;
  final bool isPreview;
  final bool isProgress;

  ImageUpdate({
    this.imageUrl,
    this.metadata,
    this.batchId,
    this.progress,
    this.currentProgress,
    this.isPreview = false,
    this.isProgress = false,
  });
}

/// Model for backend status updates
class BackendStatus {
  final String status;
  final String className;
  final String message;
  final bool anyLoading;

  BackendStatus({
    required this.status,
    required this.className,
    required this.message,
    required this.anyLoading,
  });
}

/// Model for error messages
class ErrorMessage {
  final String error;
  final DateTime timestamp;

  ErrorMessage({
    required this.error,
    required this.timestamp,
  });
}

/// Model for status updates
class StatusUpdate {
  final double waitingGens;
  final double loadingModels;
  final double waitingBackends;
  final double liveGens;

  StatusUpdate({
    required this.waitingGens,
    required this.loadingModels,
    required this.waitingBackends,
    required this.liveGens,
  });
}

class Preset {
  final String title;
  final Map<String, dynamic> parameters;

  Preset({required this.title, required this.parameters});
}
