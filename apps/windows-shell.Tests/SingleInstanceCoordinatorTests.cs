using System.Reflection;

namespace NikkiSync.WindowsShell.Tests;

public sealed class SingleInstanceCoordinatorTests
{
    [Fact]
    public void First_instance_becomes_primary()
    {
        using var fixture = CoordinatorFixture.Create();
        using var primary = (IDisposable)fixture.NewCoordinator();

        Assert.True(fixture.CallBool(primary, "TryAcquirePrimary"));
    }

    [Fact]
    public void Second_instance_cannot_become_primary_and_signals_the_primary()
    {
        using var fixture = CoordinatorFixture.Create();
        using var primary = (IDisposable)fixture.NewCoordinator();
        using var secondary = (IDisposable)fixture.NewCoordinator();

        Assert.True(fixture.CallBool(primary, "TryAcquirePrimary"));
        Assert.False(fixture.CallBool(secondary, "TryAcquirePrimary"));
        Assert.True(fixture.CallBool(secondary, "SignalExistingInstance"));
    }

    [Fact]
    public void Primary_activation_callback_fires_exactly_once_for_one_signal()
    {
        using var fixture = CoordinatorFixture.Create();
        using var primary = (IDisposable)fixture.NewCoordinator();
        using var secondary = (IDisposable)fixture.NewCoordinator();
        using var received = new ManualResetEventSlim();
        var count = 0;

        fixture.AddActivationHandler(primary, (_, _) =>
        {
            Interlocked.Increment(ref count);
            received.Set();
        });
        Assert.True(fixture.CallBool(primary, "TryAcquirePrimary"));

        Assert.True(fixture.CallBool(secondary, "SignalExistingInstance"));
        Assert.True(received.Wait(TimeSpan.FromSeconds(2)));
        Thread.Sleep(100);

        Assert.Equal(1, count);
    }

    [Fact]
    public void Releasing_primary_allows_the_next_instance_to_become_primary()
    {
        using var fixture = CoordinatorFixture.Create();
        var primary = (IDisposable)fixture.NewCoordinator();
        try
        {
            Assert.True(fixture.CallBool(primary, "TryAcquirePrimary"));
        }
        finally
        {
            primary.Dispose();
        }

        using var next = (IDisposable)fixture.NewCoordinator();
        Assert.True(fixture.CallBool(next, "TryAcquirePrimary"));
    }

    private sealed class CoordinatorFixture : IDisposable
    {
        private readonly string _mutexName = $"NikkiSync.Tests.{Guid.NewGuid():N}.Mutex";
        private readonly string _eventName = $"NikkiSync.Tests.{Guid.NewGuid():N}.Activation";
        private readonly Type _type;

        private CoordinatorFixture(Type type) => _type = type;

        public static CoordinatorFixture Create()
        {
            var assembly = typeof(DesktopWindowLifecycle).Assembly;
            var type = assembly.GetType("NikkiSync.WindowsShell.Services.SingleInstanceCoordinator");
            Assert.NotNull(type);
            return new CoordinatorFixture(type!);
        }

        public object NewCoordinator() => Activator.CreateInstance(_type, _mutexName, _eventName)!;

        public bool CallBool(object instance, string methodName) =>
            Assert.IsType<bool>(_type.GetMethod(methodName)!.Invoke(instance, null));

        public void AddActivationHandler(object instance, EventHandler handler)
        {
            var eventInfo = _type.GetEvent("ActivationRequested");
            Assert.NotNull(eventInfo);
            eventInfo!.AddEventHandler(instance, handler);
        }

        public void Dispose()
        {
        }
    }
}
