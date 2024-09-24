import 'package:flutter/material.dart';
import 'package:swarmui_flutter/models/gen_param_types.dart'; // Import the model
import 'package:swarmui_flutter/services/swarm_ui_api.dart';
import 'package:provider/provider.dart';
class InputProcessing {
  /// Processes and gathers all necessary input parameters for generation.
  static Map<String, dynamic> getGenInput({
    required BuildContext context,
    Map<String, dynamic> inputOverrides = const {},
    Map<String, dynamic> inputPreOverrides = const {},
  }) {
    // Initialize input with pre-overrides
    Map<String, dynamic> input = Map<String, dynamic>.from(inputPreOverrides);

    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    List<GenParamType> genParamTypes = api.genParamTypes;
    for (var type in genParamTypes) {
      if (type.toggleable && !type.isToggleEnabled(context)) {
        continue;
      }
      if (type.featureMissing) {
        continue;
      }
      if (type.hasGroup() && !type.isGroupToggleEnabled(context)) {
        continue;
      }

      final dynamic value = type.getValue(context);
      if (value != null) {
        input[type.id] = getInputVal(value);
      }

      if (type.id == 'prompt') {
        final imageData = type.getPromptImages(context);
        if (imageData.isNotEmpty) {
          input["promptimages"] = imageData.join('|');
        }
      }
    }

    // Handle VAE
    if (input['vae'] == null || input['vae'] == 'Automatic') {
      input['automaticvae'] = true;
      input.remove('vae');
    }
    // Handle revision images
    final revisionImages = GenParamTypeExtension.getRevisionImages(context);
    if (revisionImages.isNotEmpty) {
      input["promptimages"] = revisionImages.join('|');
    }

    // // Handle image editor data
    // if (ImageEditor.active) {
    //   input["initimage"] = ImageEditor.getFinalImageData();
    //   input["maskimage"] = ImageEditor.getFinalMaskData();
    //   input["width"] = ImageEditor.realWidth;
    //   input["height"] = ImageEditor.realHeight;

    //   if (input["initimagecreativity"] == null) {
    //     input["initimagecreativity"] = GenParamTypeExtension.getInitImageCreativity(context) ?? 0.6;
    //   }
    // }

    // Add presets
    input["presets"] = PresetManager.currentPresets.map((p) => p.title).toList();

    // Apply overrides
    input.addAll(inputOverrides);

    return input;
  }

  /// Utility function to process input values (e.g., parsing, validation)
  static dynamic getInputVal(dynamic value) {
    if (value is String) {
      return value.trim();
    } else if (value is bool) {
      return value ? 'true' : 'false';
    } else if (value is num) {
      return value.toString();
    }
    return value;
  }
}

extension GenParamTypeExtension on GenParamType {
  bool get toggleable => this.toggleable;

  bool get featureMissing => this.featureMissing;

  bool hasGroup() => group != null;

  bool isToggleEnabled(BuildContext context) {
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.isParamToggled(id);
  }

  bool isGroupToggleEnabled(BuildContext context) {
    if (group == null) return true;
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.isGroupToggled(group!.id);
  }

  dynamic getValue(BuildContext context) {
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.getParamValue(id);
  }

  List<String> getPromptImages(BuildContext context) {
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.getPromptImages(id);
  }

  static List<String> getRevisionImages(BuildContext context) {
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.getRevisionImages();
  }

  static double? getInitImageCreativity(BuildContext context) {
    final SwarmUIAPI api = Provider.of<SwarmUIAPI>(context, listen: false);
    return api.getInitImageCreativity();
  }
}

/// Mock classes for ImageEditor and PresetManager
/// Replace these with your actual implementations
class ImageEditor {
  static bool active = false;

  static String getFinalImageData() => '';
  static String getFinalMaskData() => '';
  static int get realWidth => 0;
  static int get realHeight => 0;
}

class PresetManager {
  static List<Preset> currentPresets = [];
}

class Preset {
  String title;

  Preset(this.title);
}
