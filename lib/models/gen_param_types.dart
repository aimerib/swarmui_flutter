class GenParamType {
  final String name;
  final String id;
  final String description;
  final String type;
  final String? subtype;
  dynamic defaultValue;
  final double min;
  final double max;
  final double viewMin;
  final double viewMax;
  final double step;
  final List<String>? values;
  final List<String>? valueNames;
  final List<String>? examples;
  final bool visible;
  final bool advanced;
  final String? featureFlag;
  final bool toggleable;
  final double priority;
  final Group? group; // Change from String? to Group?
  final bool alwaysRetain;
  final bool doNotSave;
  final bool doNotPreview;
  final String viewType;
  final bool extraHidden;
  final bool nonreusable;
  final bool featureMissing;

  GenParamType({
    required this.name,
    required this.id,
    required this.description,
    required this.type,
    this.subtype,
    this.defaultValue,
    required this.min,
    required this.max,
    required this.viewMin,
    required this.viewMax,
    required this.step,
    this.values,
    this.valueNames,
    this.examples,
    required this.visible,
    required this.advanced,
    this.featureFlag,
    required this.toggleable,
    required this.priority,
    this.group,
    required this.alwaysRetain,
    required this.doNotSave,
    required this.doNotPreview,
    required this.viewType,
    required this.extraHidden,
    required this.nonreusable,
    required this.featureMissing,
  });

  factory GenParamType.fromJson(Map<String, dynamic> json) {
    return GenParamType(
      name: json['name'],
      id: json['id'],
      description: json['description'],
      type: json['type'],
      subtype: json['subtype'],
      defaultValue: json['default'],
      min: (json['min'] ?? 0).toDouble(),
      max: (json['max'] ?? 0).toDouble(),
      viewMin: json['view_min'].toDouble(),
      viewMax: json['view_max'].toDouble(),
      step: json['step'].toDouble(),
      values: json['values'] != null ? List<String>.from(json['values']) : null,
      valueNames: json['value_names'] != null ? List<String>.from(json['value_names']) : null,
      examples: json['examples'] != null ? List<String>.from(json['examples']) : null,
      visible: json['visible'],
      advanced: json['advanced'],
      featureFlag: json['feature_flag'],
      toggleable: json['toggleable'],
      priority: json['priority'].toDouble(),
      group: json['group'] != null ? Group.fromJson(json['group']) : null,
      alwaysRetain: json['always_retain'],
      doNotSave: json['do_not_save'],
      doNotPreview: json['do_not_preview'],
      viewType: json['view_type'],
      extraHidden: json['extra_hidden'],
      nonreusable: json['nonreusable'],
      featureMissing: json['feature_missing'] ?? false,
    );
  }
}

class Group {
  final String name;
  final String id;
  final bool toggles;
  final bool open;
  final double priority;
  final String description;
  final bool advanced;
  final bool canShrink;

  Group({
    required this.name,
    required this.id,
    required this.toggles,
    required this.open,
    required this.priority,
    required this.description,
    required this.advanced,
    required this.canShrink,
  });

  factory Group.fromJson(Map<String, dynamic> json) {
    return Group(
      name: json['name'],
      id: json['id'],
      toggles: json['toggles'],
      open: json['open'],
      priority: (json['priority'] ?? 0).toDouble(),
      description: json['description'] ?? '',
      advanced: json['advanced'],
      canShrink: json['can_shrink'],
    );
  }
}
