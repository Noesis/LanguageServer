# NoesisGUI XAML Tools for Visual Studio Code

This extension provides a rich editing experience for [NoesisGUI](https://www.noesisengine.com/) and the XAML markup language, using the NoesisGUI Language Server. The latest release of XAML Tools can be installed from the [Visual Studio Code Marketplace](https://noesisengine.com/vscode).

[<img src="https://img.youtube.com/vi/6gDpvvSfMWI/hqdefault.jpg" width="600" height="300" />](https://www.youtube.com/watch?v=6gDpvvSfMWI)

## NoesisGUI

NoesisGUI is a lightweight cross-platform user interface library optimized for games and real-time applications. It brings the power of XAML and WPF to Unity, Unreal and proprietary engines.

Visit our [Documentation](https://www.noesisengine.com/docs/Gui.Core.Index.html) for more details and our [Forums](https://www.noesisengine.com/forums/) for feedback and suggestions.

## XAML Features

**Completion support for nodes and properties**  

Start typing a XAML tag or attribute and XAML Tools will show you a list of available symbols (controls, properties, etc.) at that location.
   
![Completion](https://raw.githubusercontent.com/Noesis/Noesis.github.io/master/NoesisGUI/LanguageServer/Readme/FeatureCompletion.gif)

**Syntax and semantic error reporting**                 

XAML Tools shows you syntax and semantic errors as you type.

![Error reporting](https://raw.githubusercontent.com/Noesis/Noesis.github.io/master/NoesisGUI/LanguageServer/Readme/FeatureError.png)

**Live previews**                                 

Open the *XAML Preview* panel and see a rendered preview of the active XAML document. This render is generated by NoesisGUI each time you make a change to the active document.

![Previews](https://raw.githubusercontent.com/Noesis/Noesis.github.io/master/NoesisGUI/LanguageServer/Readme/FeaturePreviews.gif)

**Color decorators and pickers**

Color decorators allow you to see the current color of all Brush attribute properties in your document. Clicking a decorator will allow you to select a new value using the color picker.

![Color decorators](https://raw.githubusercontent.com/Noesis/Noesis.github.io/master/NoesisGUI/LanguageServer/Readme/FeatureColor.png)

## Language Server

XAML Tools connects to a NoesisGUI Language Server, which is built on the NoesisGUI library, to provide language capabilities for XAML. The Language Server also provides information on supported types, which includes controls, extensions, converters, and view models.

Our Unreal and Unity plugins contain Language Servers, which are active while the Unreal/Unity editor is running. An editor Language Server will support all of the types available in the current Unreal/Unity project. XAML Tools will prioritise connecting to an editor Language Server, this process is automatic.

If no active Language Server is found, XAML Tools will connect to an embedded Language Server. This embedded Language Server is limited to native NoesisGUI types, custom classes are not supported.

You can verify which Language Server you are currently connected to by checking the status bar on the bottom right of the VSCode window.

![Language Server Status](https://raw.githubusercontent.com/Noesis/Noesis.github.io/master/NoesisGUI/LanguageServer/Readme/LangServerStatus.png)

## System Requirements

- VSCode 1.63.0
- Windows or MacOS