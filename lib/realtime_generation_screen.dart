// lib/realtime_generation_screen.dart

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:swarmui_flutter/logger.dart';
import 'package:swarmui_flutter/services/swarm_ui_api.dart';
import 'package:swarmui_flutter/models/gen_param_types.dart';
import 'dart:async';

import 'package:swarmui_flutter/settings_screen.dart';
import 'package:dropdown_search/dropdown_search.dart';

class RealtimeGenerationScreen extends StatefulWidget {
  const RealtimeGenerationScreen({super.key});

  @override
  RealtimeGenerationScreenState createState() =>
      RealtimeGenerationScreenState();
}

class RealtimeGenerationScreenState extends State<RealtimeGenerationScreen> {
  final TextEditingController _promptController = TextEditingController();
  final Map<String, ImageResult> _images = {};
  final Map<String, double> _progress = {};

  // Additional state variables for errors and statuses
  String? _latestError;
  StatusUpdate? _currentStatus;
  BackendStatus? _backendStatus;
  List<GenParamType> _params = [];

  late StreamSubscription<ImageUpdate> _imageSubscription;
  late StreamSubscription<ErrorMessage> _errorSubscription;
  late StreamSubscription<StatusUpdate> _statusSubscription;
  late StreamSubscription<BackendStatus> _backendStatusSubscription;

  // Map to keep track of expanded state for each group
  final Map<String, bool> _expandedGroups = {};

  final ValueNotifier<Map<String, String>> _base64ImagesNotifier =
      ValueNotifier({});

  bool _showAdvancedParams = false;

  // Add a controller for the models dropdown
  final TextEditingController _modelDropdownController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initialize();
    });
  }

  Future<void> _initialize() async {
    final swarmAPI = Provider.of<SwarmUIAPI>(context, listen: false);
    await swarmAPI.initialize();

    // Handle scenarios where the server is not set or the session is invalid
    if (!swarmAPI.isServerSet) {
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const SettingsScreen()),
      );
    } else if (!await swarmAPI.isSessionValid()) {
      // get a new session
      await swarmAPI.acquireSession();
    }

    // Check if the server is set and the session is valid
    if (swarmAPI.isServerSet && await swarmAPI.isSessionValid()) {
      _fetchParams(swarmAPI);
    }

    // Listen to image updates
    _imageSubscription = swarmAPI.imageUpdateStream.listen((update) {
      if (update.isProgress) {
        setState(() {
          _progress[update.batchId!] = update.progress!;
        });
      } else if (update.imageUrl != null) {
        setState(() {
          _images[update.batchId!] = ImageResult(
            imageUrl: update.imageUrl!,
            metadata: update.metadata ?? '',
          );
          _progress.remove(update.batchId!);
        });
      }
    });

    // Listen to error messages
    _errorSubscription = swarmAPI.errorStream.listen((error) {
      setState(() {
        _latestError = error.error;
      });
      if (!mounted) return;
      // Optionally, display a SnackBar or dialog
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${error.error}')),
      );
    });

    // Listen to status updates
    _statusSubscription = swarmAPI.statusUpdateStream.listen((status) {
      setState(() {
        _currentStatus = status;
      });
    });

    // Listen to backend status updates
    _backendStatusSubscription =
        swarmAPI.backendStatusStream.listen((backendStatus) {
      setState(() {
        _backendStatus = backendStatus;
      });
    });
  }

  Future<void> _fetchParams(SwarmUIAPI swarmAPI) async {
    try {
      final params = await swarmAPI.fetchGenParams();
      setState(() {
        _params = params;
      });
    } catch (e) {
      // Handle error
      setState(() {
        _latestError = 'Failed to fetch parameters: $e';
      });
    }
  }

  @override
  void dispose() {
    _modelDropdownController.dispose();
    _promptController.dispose();
    _imageSubscription.cancel();
    _errorSubscription.cancel();
    _statusSubscription.cancel();
    _backendStatusSubscription.cancel();
    _base64ImagesNotifier.dispose();
    super.dispose();
  }

  void _buildParameterSheet(BuildContext context, List<GenParamType> params) {
    // First, sort the params by their group priority
    params.sort((a, b) {
      // Ensure 'Model' group is first
      if (a.name == 'Model') return -1;
      if (b.name == 'Model') return 1;
      return (a.group?.priority ?? 0).compareTo(b.group?.priority ?? 0);
    });

    // Group parameters by their group name
    final Map<String?, List<GenParamType>> groupedParams = {};
    for (var param in params) {
      groupedParams.putIfAbsent(param.group?.name, () => []).add(param);
    }

    // Sort parameters within each group
    groupedParams.forEach((key, value) {
      value.sort((a, b) => a.priority.compareTo(b.priority));
    });

    // **Filter out the ReVision group**
    groupedParams.remove('ReVision');

    // **Filter out ReVision-specific parameters**
    groupedParams.forEach((key, value) {
      groupedParams[key] =
          value.where((param) => !param.name.contains('ReVision')).toList();
    });

    // TODO: Implement the ReVision feature to allow image-prompting in future updates.

    showModalBottomSheet(
      useSafeArea: true,
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setModalState) {
            return DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.9, // Start with 90% of screen height
              minChildSize:
                  0.5, // Allow sheet to be dragged down to 50% of screen height
              maxChildSize: 0.95, // Allow sheet to cover almost full screen
              builder: (context, scrollController) {
                return Column(
                  children: [
                    Expanded(
                      child: ListView(
                        controller: scrollController,
                        padding: const EdgeInsets.all(16.0),
                        children: groupedParams.entries.map((entry) {
                          final groupName = entry.key;
                          final groupParams = entry.value;

                          // Filter out advanced params if not shown
                          final visibleParams = groupParams
                              .where((param) {
                                final paramGroupAdvanced = param.group?.advanced ?? false;
                                return _showAdvancedParams || (!param.advanced && !paramGroupAdvanced);
                              })
                              .toList();

                          if (visibleParams.isEmpty) {
                            return const SizedBox.shrink();
                          }

                          if (groupName != null) {
                            // Return an ExpansionTile for grouped parameters
                            return ExpansionTile(
                              title: Text(
                                groupName,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              initiallyExpanded:
                                  _expandedGroups[groupName] ?? false,
                              onExpansionChanged: (expanded) {
                                setModalState(() {
                                  _expandedGroups[groupName] = expanded;
                                });
                              },
                              children: visibleParams.map((param) {
                                return _buildIndividualParamWidget(param);
                              }).toList(),
                            );
                          } else {
                            // Return individual parameter widgets for params without a group
                            return _buildIndividualParamWidget(
                                visibleParams.first);
                          }
                        }).toList(),
                      ),
                    ),
                    // Toggle for advanced parameters
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: SwitchListTile(
                        title: const Text('Show Advanced Parameters'),
                        value: _showAdvancedParams,
                        onChanged: (bool value) {
                          setModalState(() {
                            _showAdvancedParams = value;
                          });
                        },
                      ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _buildIndividualParamWidget(GenParamType param) {
    // Determine if the parameter is numerical
    final bool isNumerical =
        ['decimal', 'integer'].contains(param.type.toLowerCase());

    Widget titleWidget = Row(
      children: [
        if (param.advanced)
          const Padding(
            padding: EdgeInsets.only(right: 4.0),
            child: Icon(Icons.star, size: 16, color: Colors.amber),
          ),
        Flexible(
          child: Text(
            param.name,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (param.description.isNotEmpty)
          Material(
            type: MaterialType.transparency,
            child: InkWell(
              onTap: () => _showDescriptionDialog(context, param),
              borderRadius: BorderRadius.circular(20),
              child: const Padding(
                padding: EdgeInsets.only(left: 4.0, right: 4.0),
                child: Tooltip(
                  message: 'View Description',
                  child: Icon(
                    Icons.info_outline,
                    size: 20,
                    color: Colors.grey,
                  ),
                ),
              ),
            ),
          ),
      ],
    );

    Widget paramWidget;
    if (isNumerical) {
      paramWidget = Padding(
        padding: const EdgeInsets.symmetric(vertical: 8.0),
        child: Row(
          children: [
            Expanded(
              flex: 1,
              child: titleWidget,
            ),
            const SizedBox(width: 16),
            SizedBox(
              width: MediaQuery.of(context).size.width * 0.3,
              child: _buildParamInput(param),
            ),
          ],
        ),
      );
    } else if (param.type.toLowerCase() == 'boolean') {
      paramWidget = Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(child: titleWidget),
          Switch(
            value: param.defaultValue is bool
                ? param.defaultValue
                : (param.defaultValue?.toString().toLowerCase() == 'true'),
            onChanged: (value) {
              setState(() {
                param.defaultValue = value;
              });
            },
          ),
        ],
      );
    } else {
      paramWidget = Padding(
        padding: const EdgeInsets.symmetric(vertical: 8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            titleWidget,
            const SizedBox(height: 8),
            _buildParamInput(param),
          ],
        ),
      );
    }

    return paramWidget;
  }

  void _showDescriptionDialog(BuildContext context, GenParamType param) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text(param.name),
          content: Text(param.description),
          actions: <Widget>[
            TextButton(
              child: const Text('Close'),
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
          ],
        );
      },
    );
  }

  Widget _buildParamInput(GenParamType param) {
    switch (param.type.toLowerCase()) {
      case 'text':
        return _buildStringInput(param);
      case 'decimal':
        return _buildDecimalInput(param);
      case 'integer':
        return _buildIntegerInput(param);
      case 'boolean':
        return _buildBooleanInput(param);
      case 'model':
        return _buildModelInput(param);
      case 'list':
        return _buildListInput(param);
      case 'dropdown':
        return _buildDropdownInput(param);
      case 'image':
        return _buildImageInput(param);
      default:
        return Container();
    }
  }

  Widget _buildModelInput(GenParamType param) {
    final swarmAPI = Provider.of<SwarmUIAPI>(context, listen: false);

    List<String> modelOptions = [];

    // Access models using subtype, defaulting to 'default'
    final subtypeKey = param.subtype ?? '';
    final subtypeData = swarmAPI.models[subtypeKey];
    if (subtypeData is List<String>) {
      modelOptions = subtypeData;
    } else {
      debugPrint('Unexpected subtypeData type: ${subtypeData.runtimeType}');
    }

    // Ensure there are model options available
    if (modelOptions.isEmpty) {
      debugPrint('No models available for subtype: $subtypeKey');
      return const Text('No models available');
    }

    // Determine the currently selected model
    String? currentModel = swarmAPI.currentModel;
    if (!modelOptions.contains(currentModel)) {
      currentModel = modelOptions.isNotEmpty ? modelOptions.first : null;
      swarmAPI.setCurrentModel(currentModel);
    }

    return DropdownSearch<String>(
      // mode: Mode.MENU,
      items: modelOptions,
      selectedItem: currentModel,
      onChanged: (String? newValue) {
        if (newValue != null) {
          setState(() {
            param.defaultValue = newValue;
            swarmAPI.setCurrentModel(newValue);
            currentModel = newValue;
          });
          debugPrint('Selected model changed to: $newValue');
          debugPrint('Current model: $currentModel');
        } else {
          debugPrint('Selected model is null');
        }
      },
      dropdownDecoratorProps: const DropDownDecoratorProps(
        dropdownSearchDecoration: InputDecoration(
          labelText: "Select Model",
          border: OutlineInputBorder(),
          contentPadding: EdgeInsets.fromLTRB(12, 12, 8, 0),
        ),
      ),
      popupProps: PopupProps.menu(
        showSearchBox: true,
        searchFieldProps: const TextFieldProps(
          decoration: InputDecoration(
            border: OutlineInputBorder(),
            contentPadding: EdgeInsets.fromLTRB(12, 12, 8, 0),
            labelText: "Search Model",
          ),
        ),
        // Styling the list items
        itemBuilder: (context, item, isSelected) {
          return Container(
            margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: isSelected ? Colors.blueAccent.withOpacity(0.2) : Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: isSelected ? Colors.blueAccent : Colors.grey.shade300,
              ),
            ),

            child: ListTile(
              title: Text(
                item,
                style: TextStyle(
                  color: isSelected ? Colors.blueAccent : Colors.black,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ),
          );
        },
        // Styling the selected item displayed in the dropdown
        // selectedItemBuilder: (context, selectedItem) {
        //   return modelOptions.map((item) {
        //     bool isSelected = item == selectedItem;
        //     return Container(
        //       padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        //       decoration: BoxDecoration(
        //         color: isSelected ? Colors.blueAccent.withOpacity(0.1) : Colors.white,
        //         borderRadius: BorderRadius.circular(8),
        //       ),
        //       child: Text(
        //         item,
        //         style: TextStyle(
        //           color: isSelected ? Colors.blueAccent : Colors.black,
        //           fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        //         ),
        //       ),
        //     );
        //   }).toList();
        // },
        // Handling empty states
        emptyBuilder: (context, searchEntry) {
          return const Center(
            child: Text("No models found."),
          );
        },
        // Optional: Customize other builders as needed
        errorBuilder: (context, error, stackTrace) {
          return const Center(
            child: Text("An error occurred."),
          );
        },
        loadingBuilder: (context, event) {
          return const Center(
            child: CircularProgressIndicator(),
          );
        },
      ),
      // Validator remains unchanged
      validator: (value) {
        if (value == null || value.isEmpty) {
          return "Model cannot be empty";
        }
        return null;
      },
    );
  }

  Widget _buildListInput(GenParamType param) {
    return TextField(
      decoration: InputDecoration(
        hintText: param.defaultValue?.toString() ?? '',
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        border: const OutlineInputBorder(),
      ),
      onChanged: (value) {
        setState(() {
          param.defaultValue = value;
        });
      },
    );
  }

  Widget _buildImageInput(GenParamType param) {
    return ValueListenableBuilder<Map<String, String>>(
      valueListenable: _base64ImagesNotifier,
      builder: (context, base64Images, child) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ElevatedButton(
              onPressed: () async {
                await _pickAndStoreImage(param);
              },
              child: const Text('Upload'),
            ),
            if (base64Images.containsKey(param.name))
              Padding(
                padding: const EdgeInsets.only(left: 8.0),
                child: Image.memory(
                  base64Decode(base64Images[param.name]!),
                  width: 30,
                  height: 30,
                  fit: BoxFit.cover,
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _buildStringInput(GenParamType param) {
    return TextField(
      decoration: InputDecoration(
        hintText: param.defaultValue?.toString() ?? '',
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        border: const OutlineInputBorder(),
      ),
      maxLines: null, // Allows for multiline input if needed
      onChanged: (value) {
        setState(() {
          param.defaultValue = value;
        });
      },
    );
  }

  Widget _buildDecimalInput(GenParamType param) {
    return TextField(
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        hintText: param.defaultValue?.toString() ?? '',
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        border: const OutlineInputBorder(),
      ),
      onChanged: (value) {
        setState(() {
          param.defaultValue = double.tryParse(value) ?? param.min;
        });
      },
    );
  }

  Widget _buildIntegerInput(GenParamType param) {
    return TextField(
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        hintText: param.defaultValue?.toString() ?? '',
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        border: const OutlineInputBorder(),
      ),
      onChanged: (value) {
        setState(() {
          param.defaultValue = int.tryParse(value) ?? param.min.toInt();
        });
      },
    );
  }

  Widget _buildDropdownInput(GenParamType param) {
    // Extract values and display names
    final List<String> values = param.values?.cast<String>().toList() ?? [];
    final List<String> valueNames = param.valueNames?.cast<String>().toList() ?? [];

    // Determine the currently selected value
    String? selectedValue;
    if (param.defaultValue != null) {
      if (param.defaultValue is String && values.contains(param.defaultValue)) {
        selectedValue = param.defaultValue as String;
      } else {
        // If defaultValue is not directly in the values list, try to find a matching value
        selectedValue = values.firstWhere(
          (value) => value.toLowerCase() == param.defaultValue.toString().toLowerCase(),
          orElse: () => values.isNotEmpty ? values.first : "",
        );
      }
    }

    // If still no selected value and we have values, default to the first one
    selectedValue ??= values.isNotEmpty ? values.first : null;

    // Create DropdownMenuEntry list
    final List<DropdownMenuEntry<String>> entries = List.generate(
      values.length,
      (index) {
        final String value = values[index];
        final bool isSelected = value == selectedValue;

        return DropdownMenuEntry<String>(
          value: value,
          label: valueNames[index],
          // Customize the entry to highlight if it's selected
          style: isSelected
              ? MenuItemButton.styleFrom(
                          foregroundColor: Colors.white,
                          backgroundColor: Colors.blueAccent,
                        )
              : null,
        );
      },
    );

    return DropdownMenu<String>(
      controller: TextEditingController(text: selectedValue ?? ''),
      label: Text(param.name),
      dropdownMenuEntries: entries,
      onSelected: (String? newValue) {
        if (newValue != null) {
          setState(() {
            param.defaultValue = newValue;
          });
        }
      },
      // Optional: You can customize the menu's appearance further
      // For example, adding leading icons or search functionality
    );
  }

  Widget _buildBooleanInput(GenParamType param) {
    bool currentValue = param.defaultValue is bool
        ? param.defaultValue
        : (param.defaultValue?.toString().toLowerCase() == 'true');

    return Switch(
      value: currentValue,
      onChanged: (value) {
        setState(() {
          param.defaultValue = value;
        });
      },
    );
  }

  Future<void> _pickAndStoreImage(GenParamType param) async {
    final ImagePicker picker = ImagePicker();

    try {
      final XFile? image = await picker.pickImage(source: ImageSource.gallery);

      if (image != null) {
        final bytes = await image.readAsBytes();
        final base64String = base64Encode(bytes);

        // Update the notifier
        _base64ImagesNotifier.value = {
          ..._base64ImagesNotifier.value,
          param.name: base64String
        };

        // Update the param's defaultValue
        param.defaultValue = base64String;

        // Optionally, display a success message
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${param.name} uploaded successfully!')),
        );
      } else {
        // User canceled the picker
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No image selected.')),
        );
      }
    } catch (e) {
      // Handle any errors that occur during image selection
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error picking image: $e')),
      );
    }
  }

  void _showParameterSheet(BuildContext context, List<GenParamType> params) {
    _buildParameterSheet(context, params);
  }

  @override
  Widget build(BuildContext context) {
    // Calculate half of the screen width once
    final double halfScreenWidth = MediaQuery.of(context).size.width / 3;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Realtime Generation'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () {
              _showParameterSheet(context, _params);
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Consumer<SwarmUIAPI>(
          builder: (context, swarmAPI, child) {
            if (swarmAPI.status == SwarmUIAPIStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            if (swarmAPI.status == SwarmUIAPIStatus.needsSettings) {
              return const Center(
                  child: Text('Please set the server address in settings.'));
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Display Backend Status
                if (_backendStatus != null)
                  Card(
                    color: Colors.grey[200],
                    child: Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Backend Status: ${_backendStatus!.status}',
                            style: TextStyle(
                              color: _backendStatus!.status.toLowerCase() ==
                                      'running'
                                  ? Colors.green
                                  : Colors.red,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (_backendStatus!.message.isNotEmpty)
                            Text('Message: ${_backendStatus!.message}'),
                        ],
                      ),
                    ),
                  ),

                // Display General Status
                if (_currentStatus != null)
                  Card(
                    color: Colors.blue[50],
                    child: Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Status Updates:',
                              style: TextStyle(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 4),
                          Text(
                              'Waiting Generations: ${_currentStatus!.waitingGens}'),
                          Text(
                              'Loading Models: ${_currentStatus!.loadingModels}'),
                          Text(
                              'Waiting Backends: ${_currentStatus!.waitingBackends}'),
                          Text(
                              'Live Generations: ${_currentStatus!.liveGens}'),
                        ],
                      ),
                    ),
                  ),

                const SizedBox(height: 20),

                // Generate Button
                ElevatedButton(
                  onPressed: () async {
                    final prompt = _promptController.text;
                    if (prompt.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please enter a prompt')),
                      );
                      return;
                    }

                    // Clear previous images and progress
                    setState(() {
                      _images.clear();
                      _progress.clear();
                      _latestError = null;
                    });

                    // Generate a unique batch ID
                    final batchId =
                        DateTime.now().millisecondsSinceEpoch.toString();

                    // Send WebSocket request
                    await swarmAPI.sendWebSocketMessage({
                      'action': 'GenerateText2Image',
                      'session_id': swarmAPI.sessionId,
                      'prompt': prompt,
                      'batch_id': batchId,
                      'images': 1,
                    });
                  },
                  child: const Text('Generate Image'),
                ),
                const SizedBox(height: 20),

                // Display Error Messages (if any)
                if (_latestError != null)
                  Card(
                    color: Colors.red[100],
                    child: Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Text(
                        'Error: $_latestError',
                        style: TextStyle(
                            color: Colors.red[800],
                            fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),

                // Image and Progress Display
                Expanded(
                  child: (_images.isEmpty && _progress.isEmpty)
                      ? const Center(child: Text('No images generated yet.'))
                      : ListView(
                          children: [
                            // Display Generated Images
                            ..._images.entries.map((entry) {
                              final image = entry.value;
                              return Card(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Image.network(
                                      image.imageUrl,
                                      loadingBuilder:
                                          (context, child, loadingProgress) {
                                        if (loadingProgress == null) {
                                          return child;
                                        }
                                        return const Center(
                                            child: CircularProgressIndicator());
                                      },
                                      errorBuilder:
                                          (context, error, stackTrace) =>
                                              const Center(
                                        child: Icon(Icons.broken_image,
                                            color: Colors.red),
                                      ),
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.all(8.0),
                                      child:
                                          Text('Metadata: ${image.metadata}'),
                                    ),
                                  ],
                                ),
                              );
                            }),

                            // Display Progress Bars
                            ..._progress.entries.map((entry) {
                              return Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 8.0),
                                child: Card(
                                  child: Padding(
                                    padding: const EdgeInsets.all(8.0),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text('Batch ID: ${entry.key}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.bold)),
                                        const SizedBox(height: 4),
                                        LinearProgressIndicator(
                                            value: entry.value),
                                        const SizedBox(height: 4),
                                        Text(
                                            '${(entry.value * 100).toStringAsFixed(2)}% completed'),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }),
                          ],
                        ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Model for image results
class ImageResult {
  final String imageUrl;
  final String metadata;

  ImageResult({required this.imageUrl, required this.metadata});
}
